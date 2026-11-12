/**
 * Live smoke test against a deployed Navika instance.
 *
 *   npm run smoke:live                       # the production URL below
 *   npm run smoke:live -- https://other.example.com
 *
 * The local suites prove the build in this checkout. This one proves the thing
 * people actually open, which fails in ways a local run cannot: a database URL
 * that is only wrong in production, an AUTH_SECRET the platform never set, or a
 * build that predates the code. Every check here is real HTTP against the
 * deployment, using the same form-replay plumbing as `smoke:auth`.
 *
 * The most expensive failure it catches is the one that started this file: the
 * sign-in pages render perfectly from the static build while every submit 500s
 * because the server cannot reach Postgres. `/api/health` is therefore the first
 * assertion, and it is the one that names the cause instead of the symptom.
 */
import { attemptLogin, login, DEMO_PASSWORD } from "./lib/http";

const BASE = (process.argv[2] ?? process.env.LIVE_BASE ?? "https://busgraud-1528.vercel.app").replace(/\/$/, "");

type Result = { name: string; ok: boolean };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

/** The four doors, each with the title only that page should have. */
const SIGN_IN_PAGES = [
  { path: "/login", title: "Student sign in" },
  { path: "/login/parent", title: "Parent sign in" },
  { path: "/login/driver", title: "Driver sign in" },
  { path: "/login/admin", title: "Administrator sign in" },
];

/**
 * One account per role, the page it must reach, and a string that only exists
 * when the query behind that page returned seeded rows.
 */
const ROLES = [
  { role: "ADMIN", identifier: "admin", home: "/admin", mustContain: "Fleet positions" },
  { role: "DRIVER", identifier: "driver1", home: "/driver", mustContain: "North-West Corridor" },
  { role: "PARENT", identifier: "parent1", home: "/parent", mustContain: "Aarav Sharma" },
  { role: "STUDENT", identifier: "25cse01", home: "/student", mustContain: "Suryanagar Chowk" },
];

/**
 * Screens that must render for a signed-in role, beyond its dashboard, each
 * with a string that only appears when the page actually rendered.
 *
 * The marker matters more than the status code. Next streams a page: when a
 * Server Component throws after the shell has been flushed, the response is
 * still a 200 and the browser is handed a `<div>` that swaps in the error
 * boundary. That is exactly how the deployed admin dashboard first failed -
 * 200, twenty kilobytes, no content. Asserting `status === 200` alone would
 * have called that a pass.
 */
const PAGES: Record<string, { path: string; mustContain: string }[]> = {
  ADMIN: [
    { path: "/admin", mustContain: "Fleet positions" },
    { path: "/admin/students", mustContain: "New assignment" },
    { path: "/admin/drivers", mustContain: "All drivers" },
    { path: "/admin/buses", mustContain: "All buses" },
    { path: "/admin/routes", mustContain: "All routes" },
    { path: "/admin/stops", mustContain: "All stops" },
    { path: "/admin/trips", mustContain: "Schedule a trip" },
    { path: "/admin/alerts", mustContain: "Alert queue" },
    { path: "/admin/reports", mustContain: "Date range" },
  ],
  DRIVER: [
    { path: "/driver", mustContain: "North-West Corridor" },
    { path: "/driver/checklist", mustContain: "Pickup checklist" },
    { path: "/notifications", mustContain: "Notifications" },
    { path: "/install", mustContain: "Install BusGuard on your phone" },
  ],
  PARENT: [
    { path: "/parent", mustContain: "Aarav Sharma" },
    { path: "/fleet", mustContain: "Live fleet" },
    { path: "/notifications", mustContain: "Notifications" },
  ],
  STUDENT: [
    { path: "/student", mustContain: "Suryanagar Chowk" },
    { path: "/fleet", mustContain: "Live fleet" },
    { path: "/notifications", mustContain: "Notifications" },
  ],
};

/**
 * Did the page hand the browser an error boundary?
 *
 * A streamed render that throws after the shell leaves a digest in the RSC
 * payload and a `$RX(...)` retry call at the end of the document. Both are
 * invisible to a status-code assertion and both mean the page is broken.
 */
function pageThrew(html: string): boolean {
  return /:E\{\\?"digest\\?"/.test(html) || /\$RX\("B:/.test(html);
}

/** A role must not reach another role's area, and a 307 is the proof. */
const BOUNDARIES = [
  { role: "PARENT", path: "/admin", label: "a parent is redirected away from /admin" },
  { role: "DRIVER", path: "/admin", label: "a driver is redirected away from /admin" },
  { role: "STUDENT", path: "/driver/checklist", label: "a student is redirected away from the checklist" },
];

async function main() {
  section(`health — ${BASE}`);

  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await health.text();
  let healthJson: { ok?: boolean; db?: string } = {};
  try {
    healthJson = JSON.parse(healthBody);
  } catch {
    // A non-JSON body is a failure the assertion below reports.
  }
  record(
    "the database is reachable from the deployment",
    healthJson.ok === true && healthJson.db === "ok",
    healthBody,
  );

  section("the four sign-in pages exist and are the right ones");

  for (const page of SIGN_IN_PAGES) {
    const res = await fetch(`${BASE}${page.path}`);
    const html = await res.text();
    record(
      `${page.path} renders "${page.title}"`,
      res.status === 200 && html.includes(page.title),
      `-> ${res.status}`,
    );
  }

  section("each role signs in and sees its own data");

  const sessions: Record<string, Awaited<ReturnType<typeof login>>> = {};

  for (const role of ROLES) {
    try {
      const session = await login(BASE, role.identifier, DEMO_PASSWORD, role.role);
      sessions[role.role] = session;
      record(`${role.role}: "${role.identifier}" signs in`, true);

      const page = await session.get(role.home);
      record(
        `${role.role}: ${role.home} renders seeded data`,
        page.status === 200 && page.html.includes(role.mustContain),
        `-> ${page.status}, ${page.html.length} bytes`,
      );
    } catch (error) {
      record(`${role.role}: "${role.identifier}" signs in`, false, String(error));
    }
  }

  section("every role's screens render");

  for (const [role, pages] of Object.entries(PAGES)) {
    const session = sessions[role];
    if (!session) {
      record(`${role}: screens skipped (no session)`, false);
      continue;
    }
    for (const page of pages) {
      const res = await session.get(page.path);
      const threw = pageThrew(res.html);
      record(
        `${role} GET ${page.path}`,
        res.status === 200 && !threw && res.html.includes(page.mustContain),
        threw
          ? `-> ${res.status}, rendered an error boundary`
          : `-> ${res.status}, ${res.html.length} bytes`,
      );
    }
  }

  section("roll numbers");

  const upper = await attemptLogin(BASE, "25CSE01", DEMO_PASSWORD, "STUDENT");
  record("25CSE01 signs in (upper case)", Boolean(upper.cookie), upper.message);

  const last = await attemptLogin(BASE, "25cse65", DEMO_PASSWORD, "STUDENT");
  record("25cse65 signs in (last roll number)", Boolean(last.cookie), last.message);

  const old = await attemptLogin(BASE, "CSE2026-0140", DEMO_PASSWORD, "STUDENT");
  record("the retired CSE2026 roll numbers no longer sign in", !old.cookie, old.message);

  section("refusals are explained, not crashes");

  const wrongDoor = await attemptLogin(BASE, "parent1", DEMO_PASSWORD, "STUDENT");
  record(
    "a parent is refused on the student page",
    !wrongDoor.cookie && /not a student account/i.test(wrongDoor.message),
    wrongDoor.message,
  );

  const wrongPassword = await attemptLogin(BASE, "25cse02", "definitely-not-the-password", "STUDENT");
  record(
    "a wrong password is a message, not a 500",
    !wrongPassword.cookie && /incorrect/i.test(wrongPassword.message),
    wrongPassword.message,
  );

  section("a signed-in role cannot open another role's area");

  for (const boundary of BOUNDARIES) {
    const session = sessions[boundary.role];
    if (!session) {
      record(boundary.label, false, "no session");
      continue;
    }
    const page = await session.get(boundary.path);
    record(boundary.label, page.status === 307, `-> ${page.status}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`failed: ${failed.map((f) => f.name).join("; ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
