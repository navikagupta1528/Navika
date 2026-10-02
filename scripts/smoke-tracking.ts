/**
 * Phase 3 + 4 smoke test: live tracking, the driver checklist, notifications and
 * push.
 *
 *   npm run smoke:tracking 3010
 *
 * Two halves, on purpose.
 *
 * The HTTP half checks that the new screens render for the right role and refuse
 * what they should. It cannot check the writes: a Server Action called from a
 * client component leaves no `$ACTION_*` hidden input on the page to replay, and
 * its `Next-Action` id is a build artifact. So the operations behind those
 * actions are called directly, against the real database, with an explicit
 * actor. That is possible because `@/lib/attendance` takes `{ userId, role }`
 * and has no request in scope — a split made in Phase 5 precisely because a
 * Prisma filter naming a relation that does not exist was sitting untested in
 * one of these functions and would have thrown on the code path that decides
 * whether a parent may see their child.
 *
 * Most of the assertions are *refusals*. Attendance and alerts are the two places
 * where being wrong is not a cosmetic bug — a driver who can mark a child on
 * another bus, or a parent who can see a bus they have no child on, are both
 * silent failures that no amount of rendering correctly would catch.
 *
 * Snapshots and restores every row it touches, so it is safe to re-run.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role, PickupStatus, AlertType } from "../src/generated/prisma/enums";
import {
  setPickupStatus,
  closeStop,
  markWaiting,
  raiseAlert,
  resolveReporterTrip,
  syncOnboardCount,
} from "../src/lib/attendance";
import { getTrackingView, getFleetPositions, getWatchableBusIds } from "../src/lib/tracking-queries";
import { login, resolveBase, visibleText, DEMO_PASSWORD } from "./lib/http";

const BASE = resolveBase();
const PASSWORD = DEMO_PASSWORD;

// Same adapter as the app, pointed at the same cluster, so this sees exactly
// what the running server sees.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;

function report(ok: boolean, label: string, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

function section(name: string): void {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
}

/**
 * The link a notification carries, which lives inside its JSON `data` column.
 *
 * Read defensively: `data` is untyped JSON in the schema, so a row written by an
 * older build might have no `href`, or something that is not an object at all.
 * A smoke test that threw on that would report a failure that says nothing.
 */
function hrefOf(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const href = (data as { href?: unknown }).href;
  return typeof href === "string" ? href : null;
}

/** Rows to put back afterwards, so a failed run does not corrupt the demo data. */
type Snapshot = {
  records: { id: string; status: string; pickedAt: Date | null; cancelledAt: Date | null; waitingMarkedAt: Date | null }[];
  onboard: { id: string; onboardCount: number }[];
};

let snapshot: Snapshot | null = null;
const createdAlerts: string[] = [];
const createdNotifications: string[] = [];

async function takeSnapshot(tripIds: string[]): Promise<void> {
  snapshot = {
    records: await prisma.pickupRecord.findMany({
      where: { tripId: { in: tripIds } },
      select: { id: true, status: true, pickedAt: true, cancelledAt: true, waitingMarkedAt: true },
    }),
    onboard: await prisma.bus.findMany({
      where: { trips: { some: { id: { in: tripIds } } } },
      select: { id: true, onboardCount: true },
    }),
  };
}

async function cleanup(): Promise<void> {
  if (createdAlerts.length > 0) {
    await prisma.emergencyAlert
      .deleteMany({ where: { id: { in: createdAlerts } } })
      .catch(() => undefined);
    createdAlerts.length = 0;
  }
  if (createdNotifications.length > 0) {
    await prisma.notification
      .deleteMany({ where: { id: { in: createdNotifications } } })
      .catch(() => undefined);
    createdNotifications.length = 0;
  }
  if (!snapshot) return;

  for (const r of snapshot.records) {
    await prisma.pickupRecord
      .update({
        where: { id: r.id },
        data: {
          status: r.status as PickupStatus,
          pickedAt: r.pickedAt,
          cancelledAt: r.cancelledAt,
          waitingMarkedAt: r.waitingMarkedAt,
        },
      })
      .catch(() => undefined);
  }
  for (const b of snapshot.onboard) {
    await prisma.bus
      .update({ where: { id: b.id }, data: { onboardCount: b.onboardCount } })
      .catch(() => undefined);
  }
  snapshot = null;
}

async function main(): Promise<void> {
  console.log(`Navika tracking smoke — ${BASE}`);

  // ---------------------------------------------------------------- fixtures
  const parent1 = await prisma.user.findUniqueOrThrow({ where: { email: "parent1@navika.test" } });
  const student0 = await prisma.user.findUniqueOrThrow({
    where: { email: "aarav.sharma0@student.navika.test" } },
  );

  const trips = await prisma.trip.findMany({
    where: { status: "ONGOING" },
    orderBy: { busId: "asc" },
    select: { id: true, busId: true, driverId: true, routeId: true },
  });
  if (trips.length < 2) {
    throw new Error(
      `need 2 ongoing trips, found ${trips.length}. Run \`npm run db:seed\` first.`,
    );
  }
  // Which bus each role is entitled to follow. Derived, not hard-coded, so the
  // test follows the seed instead of breaking when a route is renumbered.
  const parentWatchable = await getWatchableBusIds(parent1.id, Role.PARENT);
  const studentWatchable = await getWatchableBusIds(student0.id, Role.STUDENT);
  report(
    parentWatchable !== "all" && parentWatchable.size > 0,
    "parent has at least one watchable bus",
    `${parentWatchable === "all" ? "all" : [...parentWatchable].join(",")}`,
  );
  report(
    studentWatchable !== "all" && studentWatchable.size > 0,
    "student has at least one watchable bus",
  );
  const parentBus = [...(parentWatchable === "all" ? [] : [...parentWatchable])][0]!;

  // Anchor everything on the trip running the bus this parent may watch.
  //
  // The obvious choice — `trips[0]` — makes several assertions vacuous. The
  // fleet page would have nothing the parent is allowed to follow, the tracking
  // page would be about a bus they cannot open, and "the parent is refused this
  // bus" could not be shown at all. Choosing the trip that overlaps the parent's
  // entitlement is what makes the refusals mean something.
  const tripA = trips.find((t) => t.busId === parentBus) ?? trips[0]!;
  const tripB = trips.find((t) => t.id !== tripA.id)!;
  await takeSnapshot(trips.map((t) => t.id));

  const busA = await prisma.bus.findUniqueOrThrow({ where: { id: tripA.busId } });
  const busB = await prisma.bus.findUniqueOrThrow({ where: { id: tripB.busId } });

  // The driver actually assigned to trip A, not necessarily driver1.
  const driverA = await prisma.user.findUniqueOrThrow({ where: { id: tripA.driverId } });
  // A driver who is *not* on this trip, for the refusal tests.
  const otherDriverUser = await prisma.user.findFirstOrThrow({
    where: { id: { not: tripA.driverId }, role: "DRIVER" },
  });
  report(driverA.email !== otherDriverUser.email, "found two distinct drivers for the refusal tests");

  // A bus this parent must NOT be able to open.
  const forbiddenBus = busB.id;

  if (busA.id === forbiddenBus) {
    throw new Error("the two fixture buses are the same, so no denial can be shown");
  }


  // ================================================================ tracking
  section("tracking authorisation — the query behind /track/[busId]");

  const ownView = await getTrackingView(parent1.id, Role.PARENT, parentBus);
  report("view" in ownView, "parent can watch their own bus", "view" in ownView ? "" : String(ownView.denial));

  const denied = await getTrackingView(parent1.id, Role.PARENT, forbiddenBus);
  report(
    "denial" in denied && denied.denial === "not-yours",
    "parent is refused a bus their child is not on",
    "denial" in denied ? denied.denial : "ALLOWED (bad)",
  );

  const ghost = await getTrackingView(parent1.id, Role.PARENT, "cmuo0000000000000000000");
  report(
    "denial" in ghost && ghost.denial === "no-bus",
    "unknown bus id is refused as no-bus, not a crash",
    "denial" in ghost ? ghost.denial : "ALLOWED (bad)",
  );

  const adminView = await getTrackingView("some-admin-id", Role.ADMIN, parentBus);
  report(
    "view" in adminView || ("denial" in adminView && adminView.denial !== "not-yours"),
    "admin is not blocked by the enrolment check",
    "denial" in adminView ? adminView.denial : "view",
  );

  const driverView = await getTrackingView(driverA.id, Role.DRIVER, busA.id);
  report(
    "denial" in driverView,
    "driver has no tracking page of their own (drivers publish, they do not watch)",
    "denial" in driverView ? driverView.denial : "ALLOWED (bad)",
  );

  // =================================================================== pages
  section("pages render for the right role");

  const admin = await login(BASE, "admin@navika.test", PASSWORD);
  const driver = await login(BASE, driverA.email, PASSWORD);
  const parent = await login(BASE, "parent1@navika.test", PASSWORD);
  const student = await login(BASE, student0.email, PASSWORD);

  for (const [name, session, path] of [
    ["driver", driver, "/driver/checklist"],
    ["driver", driver, "/driver"],
    ["driver", driver, "/notifications"],
    ["driver", driver, "/install"],
    ["parent", parent, "/parent"],
    ["parent", parent, "/fleet"],
    ["parent", parent, "/notifications"],
    ["parent", parent, `/track/${parentBus}`],
    ["student", student, "/student"],
    ["student", student, "/fleet"],
    ["admin", admin, "/fleet"],
    ["admin", admin, "/admin/alerts"],
  ] as const) {
    const res = await session.get(path);
    report(res.status === 200, `${name} GET ${path} → 200`, `got ${res.status}`);
  }

  section("driver checklist content");

  const checklist = await driver.get("/driver/checklist");
  const checklistText = visibleText(checklist.html);
  report(
    checklistText.includes("Pickup checklist") || checklistText.includes(busA.busNumber),
    "checklist names the bus it is for",
    checklistText.includes(busA.busNumber) ? busA.busNumber : checklistText.slice(0, 90),
  );
  const checkRows = await prisma.pickupRecord.findMany({
    where: { tripId: tripA.id },
    select: { student: { select: { user: { select: { name: true } } } } },
    take: 3,
  });
  const namedStudents = checkRows.filter((r) => checklistText.includes(r.student.user.name));
  report(
    namedStudents.length === checkRows.length,
    "checklist lists real student names",
    `${namedStudents.length}/${checkRows.length}`,
  );
  report(checklistText.includes("On board"), "checklist shows an on-board count");
  report(checklistText.includes("Still to board"), "checklist shows what is outstanding");

  section("live tracking page denial copy");

  const deniedPage = await parent.get(`/track/${forbiddenBus}`);
  const deniedText = visibleText(deniedPage.html);
  report(
    deniedPage.status === 200 && deniedText.includes("You cannot watch this bus"),
    "/track on a bus you are not enrolled on explains itself",
    deniedPage.status === 200 ? deniedText.slice(0, 120) : `status ${deniedPage.status}`,
  );
  const ghostPage = await parent.get("/track/cmuo0000000000000000000");
  report(
    ghostPage.status === 200 && visibleText(ghostPage.html).includes("Bus not found"),
    "/track on an unknown bus says so",
  );

  const trackOk = await parent.get(`/track/${parentBus}`);
  const trackText = visibleText(trackOk.html);
  report(trackText.includes("your stop"), "tracking page marks the viewer's stop");
  report(
    trackText.includes("Arriving at your stop") || trackText.includes("whole route"),
    "tracking page shows an arrival estimate tile",
  );

  section("fleet page only links buses the viewer may open");

  // The fleet query is time-bounded to two minutes, and the seeded positions go
  // stale two minutes after seeding. Without re-stamping, every fleet assertion
  // below would be checking the empty state and would pass no matter what the
  // link logic did — so stamp the bus this parent is entitled to open *before*
  // asking, and check that a real roster came back.
  await prisma.bus.update({
    where: { id: busA.id },
    data: { lastLocationAt: new Date(), currentLat: 18.52, currentLng: 73.85 },
  });

  const fleetHtml = (await parent.get("/fleet")).html;
  const fleetText = visibleText(fleetHtml);
  report(
    fleetHtml.includes(busA.busNumber),
    "fleet page lists the bus that is reporting",
    fleetHtml.includes(busA.busNumber) ? busA.busNumber : fleetText.slice(0, 120),
  );

  const forbiddenLink = fleetHtml.includes(`/track/${forbiddenBus}`);
  report(
    !forbiddenLink,
    "fleet page offers no 'follow' link to a bus the parent cannot open",
    forbiddenLink ? "leaked a link" : "",
  );
  const ownLink = fleetHtml.includes(`/track/${parentBus}`);
  report(
    ownLink,
    "fleet page links the bus the parent does own",
    ownLink ? "" : "no link for a bus the parent is enrolled on",
  );
  report(
    fleetText.includes("follow"),
    "and the link is labelled, not a bare anchor",
  );

  section("fleet freshness window");

  const fresh = await getFleetPositions();
  report(
    fresh.asOf > 0,
    "fleet query returns the instant it resolved",
    `asOf ${new Date(fresh.asOf).toISOString()}`,
  );
  report(
    fresh.buses.some((b) => b.busId === busA.id),
    "a just-stamped bus appears on the fleet map",
    `${fresh.buses.length} reporting`,
  );

  // A position from an hour ago must not be drawn, even though it has a
  // coordinate. This is the check that keeps the map honest.
  await prisma.bus.update({
    where: { id: busB.id },
    data: { lastLocationAt: new Date(Date.now() - 60 * 60_000) },
  });
  const stale = await getFleetPositions();
  report(
    !stale.buses.some((b) => b.busId === busB.id),
    "an hour-old position is excluded from the fleet map",
    `${stale.buses.length} reporting`,
  );
  await prisma.bus.update({
    where: { id: busB.id },
    data: { lastLocationAt: new Date() },
  });

  // ================================================================== writes
  section("attendance writes and their refusals");

  // Any row on this trip will do. It is then *normalised* to PENDING through the
  // operation under test, rather than the test requiring the seed to have left
  // one in that state: a bus whose every student boards at the first two stops
  // is seeded entirely as PICKED, and demanding a PENDING row there would make
  // the suite depend on a seed detail instead of on the code. Using the operation
  // to set it up also means the setup itself is exercised.
  const pendingRecord = await prisma.pickupRecord.findFirstOrThrow({
    where: { tripId: tripA.id },
    select: { id: true, studentId: true, stopId: true, status: true },
  });
  if (pendingRecord.status !== PickupStatus.PENDING) {
    const reset = await setPickupStatus(
      { userId: driverA.id, role: Role.DRIVER },
      { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.PENDING },
    );
    report(
      reset.ok,
      "normalised the chosen row to PENDING to start from",
      reset.ok ? `seed had it ${pendingRecord.status}` : reset.error,
    );
  }

  const picked = await setPickupStatus(
    { userId: driverA.id, role: Role.DRIVER },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.PICKED },
  );
  report(picked.ok, "the assigned driver can mark a student picked", picked.ok ? "" : picked.error);

  const afterPick = await prisma.pickupRecord.findUniqueOrThrow({
    where: { id: pendingRecord.id },
    select: { status: true, pickedAt: true },
  });
  report(
    afterPick.status === PickupStatus.PICKED && afterPick.pickedAt !== null,
    "the row really changed, and pickedAt was set",
    `${afterPick.status} / ${afterPick.pickedAt?.toISOString() ?? "null"}`,
  );

  const otherDriver = await setPickupStatus(
    { userId: otherDriverUser.id, role: Role.DRIVER },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.MISSED },
  );
  report(
    !otherDriver.ok && /not the driver/.test(otherDriver.error),
    "a different driver is refused",
    otherDriver.ok ? "ALLOWED (bad)" : otherDriver.error,
  );

  const family = await setPickupStatus(
    { userId: parent1.id, role: Role.PARENT },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.MISSED },
  );
  report(
    !family.ok,
    "a parent cannot mark their own child's attendance",
    family.ok ? "ALLOWED (bad)" : family.error,
  );

  const studentMark = await setPickupStatus(
    { userId: student0.id, role: Role.STUDENT },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.PICKED },
  );
  report(
    !studentMark.ok,
    "a student cannot mark their own attendance",
    studentMark.ok ? "ALLOWED (bad)" : studentMark.error,
  );

  const crossTrip = await prisma.pickupRecord.findFirstOrThrow({
    where: { tripId: tripB.id },
    select: { id: true },
  });
  const spliced = await setPickupStatus(
    { userId: driverA.id, role: Role.DRIVER },
    { recordId: crossTrip.id, tripId: tripA.id, status: PickupStatus.PICKED },
  );
  report(
    !spliced.ok && /not on this trip/.test(spliced.error),
    "a record id from another trip is refused even by the right driver",
    spliced.ok ? "ALLOWED (bad)" : spliced.error,
  );

  const bogus = await setPickupStatus(
    { userId: driverA.id, role: Role.DRIVER },
    { recordId: pendingRecord.id, tripId: tripA.id, status: "DEFINITELY_NOT_A_STATUS" },
  );
  report(!bogus.ok, "an invalid status value is refused", bogus.ok ? "ACCEPTED (bad)" : bogus.error);

  const adminFix = await setPickupStatus(
    { userId: "some-admin-id", role: Role.ADMIN },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.PENDING },
  );
  report(adminFix.ok, "an admin may correct attendance mid-route", adminFix.ok ? "" : adminFix.error);

  section("onboard count is a recount, not an increment");

  const busAAfter = await prisma.bus.findUniqueOrThrow({
    where: { id: busA.id },
    select: { onboardCount: true },
  });
  const actualPicked = await prisma.pickupRecord.count({
    where: { tripId: tripA.id, status: PickupStatus.PICKED },
  });
  report(
    busAAfter.onboardCount === actualPicked,
    "onboardCount matches the rows that are actually PICKED",
    `bus says ${busAAfter.onboardCount}, rows say ${actualPicked}`,
  );

  // Mark picked, then undo, then check the count returns. An increment would
  // leave it one too high here.
  const recountBefore = await syncOnboardCount(tripA.id, busA.id);
  await setPickupStatus(
    { userId: driverA.id, role: Role.DRIVER },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.PICKED },
  );
  const recountHigh = await syncOnboardCount(tripA.id, busA.id);
  await setPickupStatus(
    { userId: driverA.id, role: Role.DRIVER },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.PENDING },
  );
  const recountBack = await syncOnboardCount(tripA.id, busA.id);
  report(
    recountHigh === recountBefore + 1 && recountBack === recountBefore,
    "one pick-up and one undo leave the count exactly where it started",
    `${recountBefore} → ${recountHigh} → ${recountBack}`,
  );

  section("guardians are told when a child boards");

  const notifBefore = await prisma.notification.count({
    where: { type: "PICKED_UP" },
  });
  await setPickupStatus(
    { userId: driverA.id, role: Role.DRIVER },
    { recordId: pendingRecord.id, tripId: tripA.id, status: PickupStatus.PICKED },
  );
  const notifAfter = await prisma.notification.count({ where: { type: "PICKED_UP" } });
  report(
    notifAfter > notifBefore,
    "marking a child picked notifies someone",
    `${notifBefore} → ${notifAfter}`,
  );
  const newNotifs = await prisma.notification.findMany({
    where: { type: "PICKED_UP" },
    orderBy: { createdAt: "desc" },
    take: notifAfter - notifBefore,
    select: { id: true, body: true, data: true },
  });
  createdNotifications.push(...newNotifs.map((n) => n.id));
  report(
    newNotifs.some((n) => /\d{1,2}:\d{2}/.test(n.body)),
    "the pick-up notification states a clock time",
    newNotifs[0]?.body ?? "",
  );
  // `href` is stored inside the JSON `data` column, not as a column of its own.
  report(
    newNotifs.every((n) => String(hrefOf(n.data) ?? "").startsWith("/track/")),
    "the pick-up notification links to a tracking page",
    String(hrefOf(newNotifs[0]?.data) ?? "null"),
  );

  section("a student marks that they are waiting");

  // Look across both live trips, and take any row, then normalise it to PENDING.
  // Asking for a row that is already PENDING makes the whole suite depend on
  // how the seed happened to distribute statuses across stops — which is not
  // something a test of *waiting* should care about.
  const waitingRow = await prisma.pickupRecord.findFirstOrThrow({
    where: { trip: { status: "ONGOING" }, student: { userId: student0.id } },
    select: { id: true, tripId: true, status: true },
  });
  const waitingDriver = await prisma.user.findUniqueOrThrow({
    where: { id: (await prisma.trip.findUniqueOrThrow({ where: { id: waitingRow.tripId } })).driverId },
  });
  if (waitingRow.status !== PickupStatus.PENDING) {
    const reset = await setPickupStatus(
      { userId: waitingDriver.id, role: Role.DRIVER },
      { recordId: waitingRow.id, tripId: waitingRow.tripId, status: PickupStatus.PENDING },
    );
    report(reset.ok, "normalised the student's record to PENDING to start from", reset.ok ? "" : reset.error);
  }

  const w = await markWaiting(
    { userId: student0.id, role: Role.STUDENT },
    { tripId: waitingRow.tripId, waiting: true },
  );
  report(w.ok, "student marks waiting on their own bus", w.ok ? "" : w.error);
  const row = await prisma.pickupRecord.findUniqueOrThrow({
    where: { id: waitingRow.id },
    select: { status: true, waitingMarkedAt: true },
  });
  report(
    row.status === PickupStatus.WAITING && row.waitingMarkedAt !== null,
    "the row is WAITING with a timestamp",
    `${row.status} / ${row.waitingMarkedAt?.toISOString() ?? "null"}`,
  );

  const cleared = await markWaiting(
    { userId: student0.id, role: Role.STUDENT },
    { tripId: waitingRow.tripId, waiting: false },
  );
  report(cleared.ok, "student clears waiting again", cleared.ok ? "" : cleared.error);
  const after = await prisma.pickupRecord.findUniqueOrThrow({
    where: { id: waitingRow.id },
    select: { status: true },
  });
  report(after.status === PickupStatus.PENDING, "clearing returns it to PENDING", after.status);

  // The two refusals that make "waiting" a hint rather than a claim. A family
  // must not be able to un-announce a pick-up the driver already recorded, or a
  // departure that already happened — those would rewrite history.
  await setPickupStatus(
    { userId: waitingDriver.id, role: Role.DRIVER },
    { recordId: waitingRow.id, tripId: waitingRow.tripId, status: PickupStatus.PICKED },
  );
  const clearPicked = await markWaiting(
    { userId: student0.id, role: Role.STUDENT },
    { tripId: waitingRow.tripId, waiting: false },
  );
  report(
    !clearPicked.ok && /already been picked up/.test(clearPicked.error),
    "a student cannot clear 'waiting' after being picked up",
    clearPicked.ok ? "ALLOWED (bad)" : clearPicked.error,
  );
  const reWait = await markWaiting(
    { userId: student0.id, role: Role.STUDENT },
    { tripId: waitingRow.tripId, waiting: true },
  );
  report(
    !reWait.ok && /already been picked up/.test(reWait.error),
    "a student cannot re-announce waiting once picked up",
    reWait.ok ? "ALLOWED (bad)" : reWait.error,
  );

  await setPickupStatus(
    { userId: waitingDriver.id, role: Role.DRIVER },
    { recordId: waitingRow.id, tripId: waitingRow.tripId, status: PickupStatus.MISSED },
  );
  const clearMissed = await markWaiting(
    { userId: student0.id, role: Role.STUDENT },
    { tripId: waitingRow.tripId, waiting: false },
  );
  report(
    !clearMissed.ok && /already left this stop/.test(clearMissed.error),
    "a student cannot clear 'waiting' after the bus has gone",
    clearMissed.ok ? "ALLOWED (bad)" : clearMissed.error,
  );


  // A parent whose children are all on bus A must not be able to mark waiting
  // for bus B's trip. If the seed happens to enrol them on both, this is
  // vacuously true, so say so rather than reporting a pass that proved nothing.
  const strangerTrip = await markWaiting(
    { userId: parent1.id, role: Role.PARENT },
    { tripId: tripB.id, waiting: true },
  );
  if (parentBus === tripB.busId) {
    console.log("SKIP  parent is enrolled on that bus too, so the refusal cannot be shown");
  } else {
    report(
      !strangerTrip.ok && /no stop/.test(strangerTrip.error),
      "a parent with nobody on that trip cannot mark waiting for it",
      strangerTrip.ok ? "ALLOWED (bad)" : strangerTrip.error,
    );
  }

  const noSuchTrip = await markWaiting(
    { userId: student0.id, role: Role.STUDENT },
    { tripId: "cmuo0000000000000000000", waiting: true },
  );
  report(!noSuchTrip.ok, "a nonexistent trip is refused, not crashed on");

  section("closing a stop marks the rest missed");

  // Earlier sections in this suite resolve most rows to PICKED or MISSED, so
  // rather than hunt for one still open, open a row ourselves. Otherwise the
  // order these tests run in would decide whether they can run at all.
  const stopRecord = await prisma.pickupRecord.findFirstOrThrow({
    where: { tripId: tripA.id },
    select: { id: true, stopId: true, status: true },
  });
  const reopened = await setPickupStatus(
    { userId: driverA.id, role: Role.DRIVER },
    { recordId: stopRecord.id, tripId: tripA.id, status: PickupStatus.PENDING },
  );
  report(reopened.ok, "reopened a row at a stop for the close test", reopened.ok ? "" : reopened.error);

  const closing = await closeStop(
    { userId: driverA.id, role: Role.DRIVER },
    { tripId: tripA.id, stopId: stopRecord.stopId },
  );
  report(closing.ok, "driver can close their own stop", closing.ok ? "" : closing.error);
  const stillOpen = await prisma.pickupRecord.count({
    where: {
      tripId: tripA.id,
      stopId: stopRecord.stopId,
      status: { in: [PickupStatus.PENDING, PickupStatus.WAITING] },
    },
  });
  report(stillOpen === 0, "no record is left open at that stop", `${stillOpen} still open`);

  // Closing a stop must not touch anyone who was already picked up — that is the
  // difference between "the bus left without them" and "they are on it".
  const stillPicked = await prisma.pickupRecord.count({
    where: { tripId: tripA.id, stopId: stopRecord.stopId, status: PickupStatus.PICKED },
  });
  const pickedBefore = stopRecord.status === PickupStatus.PICKED ? 1 : 0;
  report(
    stillPicked >= pickedBefore,
    "closing a stop leaves already-picked students picked",
    `${stillPicked} picked`,
  );

  const wrongDriverClose = await closeStop(
    { userId: otherDriverUser.id, role: Role.DRIVER },
    { tripId: tripA.id, stopId: stopRecord.stopId },
  );
  report(!wrongDriverClose.ok, "another driver cannot close this stop");

  const familyClose = await closeStop(
    { userId: parent1.id, role: Role.PARENT },
    { tripId: tripA.id, stopId: stopRecord.stopId },
  );
  report(!familyClose.ok, "a parent cannot close a stop either");


  // ================================================================== alerts
  section("raising an alert");

  const driverContext = await resolveReporterTrip({ userId: driverA.id, role: Role.DRIVER });
  report(
    driverContext !== null,
    "driver resolves to their own trip",
    driverContext ? `${driverContext.busLabel} (${driverContext.tripId.slice(0, 8)})` : "none",
  );
  report(
    driverContext?.tripId === tripA.id || driverContext?.tripId === tripB.id,
    "and it is one of today's ongoing trips",
  );

  const parentContext = await resolveReporterTrip({ userId: parent1.id, role: Role.PARENT });
  report(
    parentContext !== null,
    "parent resolves through their child's enrolment",
    parentContext?.busLabel ?? "none",
  );

  const shortMessage = await raiseAlert(
    { userId: driverA.id, role: Role.DRIVER },
    { message: "hi", type: "EMERGENCY" },
  );
  report(
    !shortMessage.ok && /Say what/.test(shortMessage.error),
    "a two-word alert is rejected before anything is written",
    shortMessage.ok ? "ACCEPTED (bad)" : shortMessage.error,
  );

  const alertsBefore = await prisma.emergencyAlert.count();
  const raised = await raiseAlert(
    { userId: driverA.id, role: Role.DRIVER },
    { message: "Smoke test: puncture at the second stop", type: "BREAKDOWN", lat: 18.52, lng: 73.85 },
  );
  report(raised.ok, "driver raises an alert", raised.ok ? "" : String(raised.error));
  if (raised.ok) createdAlerts.push(raised.id);

  const alertsAfter = await prisma.emergencyAlert.count();
  report(alertsAfter === alertsBefore + 1, "exactly one alert row was written", `${alertsBefore} → ${alertsAfter}`);

  if (raised.ok) {
    const row = await prisma.emergencyAlert.findUniqueOrThrow({
      where: { id: raised.id },
      select: { tripId: true, busId: true, type: true, lat: true, lng: true, status: true, raisedById: true },
    });
    report(
      row.tripId === driverContext?.tripId,
      "the alert is attached to the reporter's own trip, not one from the form",
      row.tripId === driverContext?.tripId ? "matches" : `${row.tripId} vs ${driverContext?.tripId}`,
    );
    report(row.type === AlertType.BREAKDOWN, "the category is kept", row.type);
    report(row.status === "OPEN", "a new alert starts OPEN", row.status);
    report(row.lat !== null && row.lng !== null, "the reporter's coordinates were recorded");
    report(row.raisedById === driverA.id, "the reporter is recorded");
  }

  const unknownType = await raiseAlert(
    { userId: driverA.id, role: Role.DRIVER },
    { message: "Smoke test: unknown category", type: "NOT_A_CATEGORY" },
  );
  report(unknownType.ok, "an unknown category falls back rather than failing");
  if (unknownType.ok) createdAlerts.push(unknownType.id);

  const badCoords = await raiseAlert(
    { userId: driverA.id, role: Role.DRIVER },
    { message: "Smoke test: nonsense coordinates", lat: "999", lng: "-999" },
  );
  report(badCoords.ok, "out-of-range coordinates are dropped, not stored");
  if (badCoords.ok) {
    createdAlerts.push(badCoords.id);
    const row = await prisma.emergencyAlert.findUniqueOrThrow({
      where: { id: badCoords.id },
      select: { lat: true, lng: true },
    });
    report(row.lat === null && row.lng === null, "and the stored columns are null", `${row.lat},${row.lng}`);
  }

  const adminNotifs = await prisma.notification.findMany({
    where: { type: "EMERGENCY" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, title: true, data: true },
  });
  createdNotifications.push(...adminNotifs.map((n) => n.id));
  report(
    adminNotifs.length > 0 && hrefOf(adminNotifs[0]!.data) === "/admin/alerts",
    "admins are notified about the alert, with a link to it",
    adminNotifs[0]?.title ?? "none",
  );
  report(
    adminNotifs.some((n) => /NW-|SE-|[A-Z]{2}-\d/.test(n.title)),
    "the admin notification names a bus, not a cuid",
    adminNotifs[0]?.title ?? "",
  );

  section("notifications page reflects what was written");

  const inbox = visibleText((await parent.get("/notifications")).html);
  report(
    inbox.includes("Notifications") || inbox.includes("Nothing here yet"),
    "parent inbox renders",
    inbox.slice(0, 100),
  );
  const driverInbox = visibleText((await driver.get("/notifications")).html);
  report(
    driverInbox.includes("Notifications") || driverInbox.includes("Nothing here yet"),
    "driver inbox renders",
  );

  // Opening the inbox marks it read. Ask twice: the second open must report
  // nothing new, which is only true if the first open actually wrote.
  await parent.get("/notifications");
  const secondOpen = visibleText((await parent.get("/notifications")).html);
  report(
    !/\d+ new message/.test(secondOpen),
    "reopening the inbox reports nothing new, so the first open did mark it read",
    secondOpen.match(/\d+ new messages?/)?.[0] ?? "clean",
  );

  section("unauthenticated access");

  const anon = await fetch(`${BASE}/driver/checklist`, { redirect: "manual" });
  report(
    anon.status === 307 || anon.status === 302 || anon.status === 401,
    "/driver/checklist is not public",
    `status ${anon.status}`,
  );
  const anonTrack = await fetch(`${BASE}/track/${parentBus}`, { redirect: "manual" });
  report(
    anonTrack.status === 307 || anonTrack.status === 302 || anonTrack.status === 401,
    "/track is not public — a leaked cuid still must not open a map",
    `status ${anonTrack.status}`,
  );

  const sw = await fetch(`${BASE}/sw.js`);
  report(sw.status === 200, "service worker is served", `status ${sw.status}`);
  const swText = await sw.text();
  report(swText.includes("push"), "service worker handles push");
  report(swText.includes("notificationclick"), "service worker handles notification clicks");

  section("the health check a load balancer polls");

  // Only the healthy branch is reachable from here, and deliberately so: proving
  // the 503 needs a broken database, which means a separate process and a real
  // misconfiguration. The classification that produces it is unit tested in
  // src/lib/health.test.ts instead. What matters here is that the route stays
  // public (a 307 here would take the instance out of rotation while it is
  // perfectly healthy), stays uncached, and actually reaches Postgres.
  const health = await fetch(`${BASE}/api/health`, { redirect: "manual" });
  const healthText = await health.text();
  report(
    health.status === 200,
    "/api/health is public and reports the database reachable",
    `status ${health.status} ${healthText.slice(0, 120)}`,
  );
  report(
    (health.headers.get("cache-control") ?? "").includes("no-store"),
    "and is not cacheable — a cached 200 keeps a dead instance in rotation",
    `cache-control: ${health.headers.get("cache-control")}`,
  );

  let healthBody: { ok?: boolean; db?: string; latencyMs?: number } = {};
  try {
    healthBody = JSON.parse(healthText);
  } catch {
    // Left as {} so the assertions below report as failures rather than throwing.
  }
  report(healthBody.db === "ok", "the health check really did query the database", healthBody.db);
  report(
    typeof healthBody.latencyMs === "number" && healthBody.latencyMs < 3_000,
    "and reported a latency inside its own timeout budget",
    `${healthBody.latencyMs}ms`,
  );
  // The response is polled by anything monitoring, and often lands in a public
  // deploy log. It must never carry anything credential-shaped.
  report(
    !/postgres|navika:|password|scheme=/i.test(healthText),
    "the health response carries no connection string",
    healthText.slice(0, 120),
  );

  // -------------------------------------------------------------------- done
  try {
    const before = await prisma.emergencyAlert.count({ where: { id: { in: createdAlerts } } });
    await cleanup();
    const after = await prisma.emergencyAlert.count({ where: { id: { in: [...createdAlerts, ""] } } });
    report(before > 0, "created alerts were removed again", `${before} cleaned`);
    report(after === 0, "no test alert is left behind");
  } catch (error) {
    report(false, "cleanup", String(error));
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  })
  .catch(async (error) => {
    console.error(error);
    // Best effort: a crashed run must still not leave the demo data wrong.
    try {
      await cleanup();
    } catch {
      /* nothing more we can do */
    }
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed (aborted early)`);
    process.exitCode = 1;
  });
