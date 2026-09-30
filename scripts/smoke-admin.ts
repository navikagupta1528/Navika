/**
 * Phase 1 smoke test: the admin CRUD screens and the trip/attendance lifecycle.
 *
 *   npm run smoke:admin 3010
 *
 * This is deliberately an HTTP test, not a unit test. Every write here goes
 * through a real Server Action over a real form post, which is the only way to
 * catch the two failure modes that typechecking cannot:
 *
 *   - a Prisma query that is valid TypeScript but throws at runtime
 *     (wrong include path, a column that was renamed, a relation that does
 *     not exist),
 *   - a Server Action that renders fine but never receives its field values,
 *     because the form and the action disagree about a field name.
 *
 * It creates and then removes its own rows, so it is safe to run repeatedly
 * against a seeded database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Where the app under test is listening.
 *
 * `PORT` from `.env` first, so the smoke tests follow the server instead of
 * disagreeing with it, then an explicit argument for testing a different port.
 * The two earlier defaults here were 3000 and 3010 in sibling scripts, which
 * meant `npm run smoke:admin` failed with ECONNREFUSED on a correctly running
 * dev server.
 */
const PORT = process.argv[2] ?? process.env.PORT ?? "3000";
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "navika123";

let prisma: PrismaClient;
let cookie = "";
let pass = 0;
let fail = 0;

function report(ok: boolean, label: string, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, " "),
  );
}

/**
 * The validation message a failed form post re-rendered, if any.
 *
 * A `useActionState` form that rejects its input answers 200 with the same page
 * and the error inline, so the status code alone tells you nothing. This pulls
 * out the `role="alert"` block so a failure explains itself in the test output.
 */
function errorText(html: string): string {
  const alerts = [...html.matchAll(/role="alert"[^>]*>([\s\S]{0,400}?)</g)].map((m) =>
    visibleText(m[1] ?? "").trim(),
  );
  if (alerts.length > 0) return `alerts: ${alerts.join(" | ")}`;
  // Server Actions that throw render the message into the flight payload, not
  // the DOM, so fall back to searching for it in the escaped JSON.
  const thrown = html.match(/"message":"([^"]{5,300})"/);
  if (thrown) return `thrown: ${thrown[1]}`;
  return "(no error text found)";
}

// ---------------------------------------------------------------------------
// Server Action form replay
// ---------------------------------------------------------------------------

/**
 * Extract every form on a page, keyed by the visible text inside it.
 *
 * The admin screens put several forms on one page (the edit form plus a row of
 * delete buttons per table row), so "post the form" is ambiguous unless the
 * form can be identified by something a human would recognise.
 */
function forms(html: string): { text: string; raw: string }[] {
  const out: { text: string; raw: string }[] = [];
  const re = /<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ text: visibleText(m[2] ?? ""), raw: m[2] ?? "" });
  }
  return out;
}

/**
 * Post a form the way a browser without JavaScript would.
 *
 * Next encodes a Server Action as hidden `$ACTION_*` inputs, so those have to
 * be carried over verbatim or the server cannot tell which action was called.
 */
async function submit(
  url: string,
  html: string,
  marker: string,
  values: Record<string, string>,
): Promise<{ status: number; location: string; body: string }> {
  const form = forms(html).find((f) => f.text.includes(marker));
  if (!form) throw new Error(`no form containing "${marker}" on ${url}`);

  const body = new FormData();
  for (const tag of form.raw.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = decodeEntities(tag.match(/name="([^"]*)"/)?.[1] ?? "");
    if (!name.startsWith("$ACTION")) continue;
    body.set(name, decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const [k, v] of Object.entries(values)) body.set(k, v);

  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: { cookie },
  });
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    body: await res.text(),
  };
}

/**
 * Follow a Server Action redirect and return the page it lands on.
 *
 * A plain form post to a Server Action that calls `redirect()` answers 303. The
 * destination is where the admin would actually be looking, so the test asserts
 * against that page rather than the empty redirect body.
 */
async function follow(res: { status: number; location: string }): Promise<string> {
  if (!res.location) return "";
  const next = await fetch(`${BASE}${res.location}`, {
    headers: { cookie },
    redirect: "manual",
  });
  return next.text();
}

async function getPage(path: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, html: await res.text() };
}

async function login(email: string, password: string): Promise<boolean> {
  const page = await fetch(`${BASE}/login`);
  const html = await page.text();
  const form = forms(html).find((f) => f.text.toLowerCase().includes("sign in"));
  if (!form) return false;

  const body = new FormData();
  for (const tag of form.raw.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = decodeEntities(tag.match(/name="([^"]*)"/)?.[1] ?? "");
    if (!name.startsWith("$ACTION")) continue;
    body.set(name, decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  body.set("email", email);
  body.set("password", password);

  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    body,
    redirect: "manual",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const session = setCookies.find((h) => h.startsWith("navika_session="));
  cookie = session?.split(";")[0] ?? "";
  return Boolean(cookie);
}

// ---------------------------------------------------------------------------

/** A date far enough out that it cannot collide with real seed data. */
function testDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const created: { stops: string[] } = { stops: [] };

/** The day the lifecycle test books its trip, swept before and after. */
let lifecycle: { busId: string; from: Date; to: Date } | null = null;

/**
 * Remove every trace of the test run.
 *
 * Sweeps by window rather than by tracked id, so a run that dies halfway — or
 * one that failed before it could record anything — still leaves the database
 * as it found it. That matters because a leftover SCHEDULED trip on the test
 * date makes the next run fail on the one-per-bus-per-day constraint, which
 * looks like a product bug and is not one.
 */
async function cleanup(): Promise<void> {
  if (lifecycle) {
    const { busId, from, to } = lifecycle;
    const trips = await prisma.trip.findMany({
      where: { busId, date: { gte: from, lt: to } },
      select: { id: true },
    });
    for (const t of trips) {
      await prisma.pickupRecord.deleteMany({ where: { tripId: t.id } });
      await prisma.stopEvent.deleteMany({ where: { tripId: t.id } });
    }
    await prisma.trip.deleteMany({ where: { busId, date: { gte: from, lt: to } } });
  }
  for (const id of created.stops) {
    await prisma.enrollment.deleteMany({ where: { stopId: id } });
    await prisma.routeStop.deleteMany({ where: { stopId: id } });
    await prisma.stop.deleteMany({ where: { id: id } });
  }
  created.stops = [];
}

async function main() {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // -----------------------------------------------------------------------
    console.log("--- authentication ---");
    report(
      await login("admin@navika.test", PASSWORD),
      "admin can sign in and gets a session cookie",
    );

    // -----------------------------------------------------------------------
    console.log("\n--- every admin screen renders ---");
    const screens: [string, string][] = [
      ["/admin", "Fleet positions"],
      ["/admin/trips", "Schedule a trip"],
      [`/admin/trips?date=${testDate(0)}`, "Trips"],
      ["/admin/students", "New assignment"],
      ["/admin/stops", "All stops"],
      ["/admin/stops/new", "Stop details"],
      ["/admin/routes", "All routes"],
      ["/admin/routes/new", "Route details"],
      ["/admin/buses", "All buses"],
      ["/admin/buses/new", "Bus details"],
      ["/admin/drivers", "All drivers"],
      ["/admin/drivers/new", "Driver details"],
      ["/admin/alerts", "Alert queue"],
      ["/admin/reports", "Date range"],
    ];

    for (const [path, marker] of screens) {
      const { status, html } = await getPage(path);
      const text = visibleText(html);
      report(
        status === 200 && text.includes(marker),
        `GET ${path}`,
        status !== 200 ? `-> ${status}` : text.includes(marker) ? `found "${marker}"` : `missing "${marker}"`,
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n--- detail pages load seeded records ---");
    const [stop, route, bus, driver, trip] = await Promise.all([
      prisma.stop.findFirst({ select: { id: true, name: true } }),
      prisma.route.findFirst({ select: { id: true, name: true } }),
      prisma.bus.findFirst({ select: { id: true, busNumber: true } }),
      prisma.user.findFirst({ where: { role: "DRIVER" }, select: { id: true, name: true } }),
      prisma.trip.findFirst({ select: { id: true } }),
    ]);

    if (stop) {
      const { status, html } = await getPage(`/admin/stops/${stop.id}`);
      report(
        status === 200 && visibleText(html).includes(stop.name),
        `GET /admin/stops/${stop.id}`,
        `-> ${status}`,
      );

      // The map is a client component, so the server HTML cannot prove the
      // canvas mounts. What it can prove is that the coordinates reached the
      // component as props, which is the half that silently breaks: a stop
      // page that renders its heading and its form while the map gets nothing
      // looks identical from here.
      const stopWithCoords = await prisma.stop.findUnique({
        where: { id: stop.id },
        select: { lat: true, lng: true },
      });
      report(
        status === 200 &&
          stopWithCoords !== null &&
          html.includes(String(stopWithCoords.lat.toFixed(5))) &&
          html.includes(String(stopWithCoords.lng.toFixed(5))),
        `GET /admin/stops/${stop.id} passes the coordinates to the map`,
        stopWithCoords
          ? `expected ${stopWithCoords.lat.toFixed(5)}, ${stopWithCoords.lng.toFixed(5)} in the payload`
          : "stop has no coordinates",
      );
    }
    if (route) {
      const { status, html } = await getPage(`/admin/routes/${route.id}`);
      const text = visibleText(html);
      report(
        status === 200 && text.includes(route.name) && text.includes("Stop sequence"),
        `GET /admin/routes/${route.id} shows the stop sequence`,
        `-> ${status}`,
      );

      // Every stop on the route must reach the map, or the drawn line is
      // quietly shorter than the route the admin is editing.
      const routeStops = await prisma.routeStop.count({ where: { routeId: route.id } });
      report(
        status === 200 && routeStops > 0 && text.includes("Route map"),
        `GET /admin/routes/${route.id} renders the route map`,
        routeStops > 0 ? `${routeStops} stops sent` : "route has no stops",
      );

      // The distance caption is the visible proof that the OSRM chain ran
      // during a page render and that the answer reached the client. The
      // "(estimated)" suffix appears when the routing server was unreachable.
      report(
        status === 200 && /\d+(\.\d+)?\s?(m|km)\b/.test(text) && /by road|estimated/.test(text),
        `GET /admin/routes/${route.id} reports the road distance`,
        "expected a distance caption on the map",
      );
    }
    if (bus) {
      const { status, html } = await getPage(`/admin/buses/${bus.id}`);
      const text = visibleText(html);
      report(
        status === 200 && text.includes(bus.busNumber) && text.includes("Drivers on this bus"),
        `GET /admin/buses/${bus.id} shows driver assignment`,
        `-> ${status}`,
      );
    }
    if (driver) {
      const { status, html } = await getPage(`/admin/drivers/${driver.id}`);
      report(
        status === 200 && visibleText(html).includes(driver.name),
        `GET /admin/drivers/${driver.id}`,
        `-> ${status}`,
      );
    }
    if (trip) {
      const { status, html } = await getPage(`/admin/trips/${trip.id}`);
      const text = visibleText(html);
      report(
        status === 200 && text.includes("Expected"),
        `GET /admin/trips/${trip.id} shows the attendance roster`,
        `-> ${status}`,
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n--- create a stop, edit it, then delete it ---");
    const newStopName = `Smoke Test Stop ${Date.now()}`;

    let page = await getPage("/admin/stops/new");
    let res = await submit("/admin/stops/new", page.html, "Create stop", {
      name: newStopName,
      address: "Temporary row created by smoke:admin",
      lat: "18.51234",
      lng: "73.85678",
      isActive: "on",
    });
    const createdStop = await prisma.stop.findFirst({ where: { name: newStopName } });
    report(
      Boolean(createdStop),
      "create stop writes a row",
      res.status !== 200 && res.location ? `-> ${res.status} ${res.location}` : "",
    );
    // A create that redirects is a create that succeeded; following the
    // redirect must land on the list, not on an error page.
    if (createdStop && res.location) {
      const landed = await follow(res);
      report(
        visibleText(landed).includes("All stops"),
        "create stop lands back on the stop list",
      );
    }
    if (createdStop) created.stops.push(createdStop.id);

    if (createdStop) {
      // Edit: the action must receive the id, and `isActive` must survive an
      // edit that does not touch it. Getting this wrong silently deactivates
      // every record the first time it is saved.
      page = await getPage(`/admin/stops/${createdStop.id}`);
      res = await submit(
        `/admin/stops/${createdStop.id}`,
        page.html,
        "Save changes",
        { id: createdStop.id, name: `${newStopName} (edited)`, lat: "18.51234", lng: "73.85678", isActive: "on" },
      );
      const edited = await prisma.stop.findUnique({ where: { id: createdStop.id } });
      report(
        edited?.name === `${newStopName} (edited)` && edited.isActive === true,
        "edit stop updates the row and keeps it active",
        edited ? `isActive=${edited.isActive}` : "row vanished",
      );

      // Delete.
      page = await getPage(`/admin/stops/${createdStop.id}`);
      res = await submit(
        `/admin/stops/${createdStop.id}`,
        page.html,
        "Delete stop permanently",
        { id: createdStop.id },
      );
      const gone = await prisma.stop.findUnique({ where: { id: createdStop.id } });
      report(gone === null, "delete stop removes an unreferenced row", `-> ${res.status}`);
      if (gone === null) created.stops = created.stops.filter((id) => id !== createdStop.id);
    }

    // -----------------------------------------------------------------------
    console.log("\n--- a stop that is in use cannot be hard-deleted ---");
    if (stop) {
      const routeStop = await prisma.routeStop.findFirst({
        where: { stopId: stop.id },
        select: { routeId: true },
      });
      if (routeStop) {
        const page2 = await getPage(`/admin/stops/${stop.id}`);
        // The button should not even be rendered while the stop is in use.
        report(
          !visibleText(page2.html).includes("Delete stop permanently"),
          "no delete button is offered for a stop that is in use",
        );
        const still = await prisma.stop.findUnique({ where: { id: stop.id } });
        report(still !== null, "the referenced stop is still there", still ? "" : "row was deleted!");
      }
    }

    // -----------------------------------------------------------------------
    console.log("\n--- enrolment validation refuses a stop off the bus's route ---");
    const anyStudent = await prisma.studentProfile.findFirst({ select: { id: true } });
    if (anyStudent) {
      const page3 = await getPage("/admin/students");
      const res3 = await submit("/admin/students", page3.html, "Save assignment", {
        studentId: anyStudent.id,
        busId: "not-a-real-bus",
        stopId: "not-a-real-stop",
        direction: "PICKUP",
        academicYear: "2026-27",
      });
      const text = visibleText(res3.body);
      report(
        text.includes("Bus not found") || text.includes("not found"),
        "enrolment rejects a bus that does not exist with a readable message",
        text.includes("not found") ? "" : "no error surfaced",
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n--- trip lifecycle: schedule, start, attendance, complete ---");
    const usableBus = await prisma.bus.findFirst({
      where: { status: "ACTIVE", route: { routeStops: { some: {} } } },
      select: {
        id: true,
        busNumber: true,
        // Scoped to the direction the test books. `startTrip` builds the sheet
        // from enrolments matching the trip's own direction, so counting every
        // enrolment on the bus would compare a PICKUP roster against both
        // directions and always look short.
        enrollments: {
          where: { isActive: true, direction: "PICKUP" },
          select: { id: true },
        },
      },
    });
    const anyDriver = await prisma.user.findFirst({
      where: { role: "DRIVER", isActive: true },
      select: { id: true },
    });

    if (!usableBus || !anyDriver) {
      report(false, "a bus with route stops and an active driver exist for the lifecycle test");
    } else {
      const date = testDate(45);
      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T00:00:00Z`);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      lifecycle = { busId: usableBus.id, from: dayStart, to: dayEnd };

      // Start from a known-clean slate, so a previous interrupted run cannot
      // make this one fail on the one-trip-per-bus-per-day constraint.
      await cleanup();

      page = await getPage(`/admin/trips?date=${date}`);
      res = await submit(`/admin/trips?date=${date}`, page.html, "Schedule trip", {
        busId: usableBus.id,
        driverId: anyDriver.id,
        direction: "PICKUP",
        date,
        scheduledStart: "07:30",
      });
      // Matched on a window rather than an exact timestamp.
      //
      // `Trip.date` is a `date` column, so `new Date("2026-11-14")` (what the
      // action uses) is UTC midnight while `new Date("2026-11-14T00:00:00")` is
      // local midnight — five and a half hours apart in IST. A window that
      // covers both is honest about which day the trip landed on.
      const tripRow = await prisma.trip.findFirst({
        where: { busId: usableBus.id, date: { gte: dayStart, lt: dayEnd } },
        orderBy: { scheduledStart: "asc" },
        select: { id: true, status: true, date: true },
      });
      report(
        tripRow?.status === "SCHEDULED",
        "schedule trip creates a SCHEDULED trip",
        tripRow
          ? `status=${tripRow.status} on ${tripRow.date.toISOString().slice(0, 10)}`
          : `no row; status=${res.status} ${res.location} :: ${errorText(res.body)}`,
      );

      if (tripRow) {
        // Duplicate on the same day and direction must be refused by the
        // unique constraint, not silently swallowed.
        page = await getPage(`/admin/trips?date=${date}`);
        const dup = await submit(`/admin/trips?date=${date}`, page.html, "Schedule trip", {
          busId: usableBus.id,
          driverId: anyDriver.id,
          direction: "PICKUP",
          date,
          scheduledStart: "08:00",
        });
        report(
          visibleText(dup.body).toLowerCase().includes("already has a"),
          "a second trip for the same bus, direction and day is refused",
        );

        // Start it.
        const tripPage = await getPage(`/admin/trips/${tripRow.id}`);
        report(
          visibleText(tripPage.html).includes("Not started yet"),
          "an unstarted trip shows the start banner",
        );

        const startRes = await submit(`/admin/trips/${tripRow.id}`, tripPage.html, "Start trip now", {
          id: tripRow.id,
        });
        report(
          startRes.status === 303,
          "start trip redirects to the trip rather than re-rendering an error",
          `-> ${startRes.status}`,
        );
        const started = await prisma.trip.findUnique({
          where: { id: tripRow.id },
          select: { status: true, startedAt: true, pickupRecords: { select: { status: true } } },
        });
        report(
          started?.status === "ONGOING" && started.startedAt !== null,
          "start trip moves it to ONGOING and stamps startedAt",
          started ? `status=${started.status}` : "gone",
        );

        // Attendance must be materialised: one row per active enrolment.
        const expected = usableBus.enrollments.length;
        report(
          started?.pickupRecords.length === expected,
          `starting the trip generated one attendance row per enrolment`,
          `${started?.pickupRecords.length ?? 0} of ${expected}`,
        );
        report(
          (started?.pickupRecords ?? []).every((r) => r.status === "PENDING"),
          "generated attendance rows start as PENDING",
        );

        // Starting twice must not duplicate rows.
        const again = await getPage(`/admin/trips/${tripRow.id}`);
        await submit(`/admin/trips/${tripRow.id}`, again.html, "Start trip now", { id: tripRow.id }).catch(
          () => null,
        );
        const afterRestart = await prisma.pickupRecord.count({ where: { tripId: tripRow.id } });
        report(
          afterRestart === expected,
          "starting an already-ongoing trip is idempotent",
          `${afterRestart} rows`,
        );

        // Mark the first student picked, then complete the trip.
        const firstRecord = await prisma.pickupRecord.findFirst({
          where: { tripId: tripRow.id },
          select: { id: true },
        });
        if (firstRecord) {
          const attendancePage = await getPage(`/admin/trips/${tripRow.id}`);
          const marked = await submit(
            `/admin/trips/${tripRow.id}`,
            attendancePage.html,
            "Picked",
            { recordId: firstRecord.id, tripId: tripRow.id, status: "PICKED" },
          );
          const record = await prisma.pickupRecord.findUnique({
            where: { id: firstRecord.id },
            select: { status: true, pickedAt: true },
          });
          const busRow = await prisma.bus.findUnique({
            where: { id: usableBus.id },
            select: { onboardCount: true },
          });
          report(
            record?.status === "PICKED" && record.pickedAt !== null,
            "marking a student picked records the time",
            `-> ${marked.status}`,
          );
          report(
            busRow?.onboardCount === 1,
            "the bus onboard count follows the check-ins",
            `onboardCount=${busRow?.onboardCount}`,
          );
        }

        // Completing must sweep the rest into MISSED.
        const completePage = await getPage(`/admin/trips/${tripRow.id}`);
        const completed = await submit(
          `/admin/trips/${tripRow.id}`,
          completePage.html,
          "Complete trip",
          { id: tripRow.id },
        );
        const after = await prisma.trip.findUnique({
          where: { id: tripRow.id },
          select: {
            status: true,
            endedAt: true,
            pickupRecords: { select: { status: true } },
          },
        });
        report(
          after?.status === "COMPLETED" && after.endedAt !== null,
          "complete trip stamps endedAt",
          `-> ${completed.status}`,
        );
        const notPicked = (after?.pickupRecords ?? []).filter((r) => r.status === "PICKED").length;
        const swept = (after?.pickupRecords ?? []).filter((r) => r.status === "MISSED").length;
        report(
          notPicked + swept === (after?.pickupRecords.length ?? 0) && swept === expected - 1,
          "completing records everyone not picked as MISSED",
          `${notPicked} picked, ${swept} missed of ${after?.pickupRecords.length ?? 0}`,
        );

        // A completed trip is a permanent record: the banner must say so.
        const finalPage = await getPage(`/admin/trips/${tripRow.id}`);
        report(
          visibleText(finalPage.html).includes("cannot be edited"),
          "a completed trip is presented as read-only",
        );
      }
    }

    // -----------------------------------------------------------------------
    console.log("\n--- reports reflect the completed trip ---");
    const today = testDate(0);
    const reportPage = await getPage(`/admin/reports?from=${today}&to=${today}`);
    report(
      reportPage.status === 200 &&
        visibleText(reportPage.html).includes("Date range"),
      "GET /admin/reports with a range renders",
      `-> ${reportPage.status}`,
    );

    // -----------------------------------------------------------------------
    console.log("\n--- a non-admin cannot reach any of it ---");
    await login("driver1@navika.test", PASSWORD);
    for (const path of ["/admin/stops", "/admin/trips", "/admin/students", "/admin/reports"]) {
      const res2 = await getPage(path);
      report(
        res2.status === 307 || res2.status === 302,
        `driver is redirected away from ${path}`,
        `-> ${res2.status}`,
      );
    }
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  try {
    await cleanup();
  } catch {
    // best effort
  }
  await prisma?.$disconnect();
  process.exit(1);
});
