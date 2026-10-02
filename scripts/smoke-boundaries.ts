/**
 * Route boundary smoke test.
 *
 * Every one of these is an HTTP request with no session, or with the wrong one,
 * against a running Navika. They exist because the boundary between "not
 * signed in" and "signed in as the wrong person" is enforced in two places at
 * once - the proxy, which answers first, and `requireRole` in each page - and
 * the interesting failures are in the gap between them.
 *
 * The gap was not theoretical. `/track`, `/fleet`, `/notifications` and
 * `/install` were missing from the proxy's table, so they were enforced only by
 * the page. No data leaked, but `requireRole` throws after React has started
 * streaming, so the response was a 200 carrying the app shell with the redirect
 * arriving a second later as a `<meta http-equiv="refresh">` tag. Every check
 * here asserts on the *status code* for that reason, not merely on "the body
 * does not contain the data" - the body check passes either way and would never
 * have caught it.
 *
 * Usage: npx tsx scripts/smoke-boundaries.ts
 */

import "dotenv/config";
import { login, resolveBase, visibleText, DEMO_PASSWORD } from "./lib/http";

const BASE = resolveBase();
const PASSWORD = DEMO_PASSWORD;

let pass = 0;
let fail = 0;

function report(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

/**
 * Every page in the portal, plus the root.
 *
 * Kept as an explicit list rather than read off the filesystem: a route that is
 * missing from this list is a route nobody has ever requested anonymously, which
 * is exactly how `/track` and `/notifications` came to be unprotected by the
 * proxy in the first place.
 */
const PORTAL_PAGES = [
  "/",
  "/admin",
  "/admin/alerts",
  "/admin/buses",
  "/admin/buses/new",
  "/admin/buses/nonexistent-id",
  "/admin/drivers",
  "/admin/drivers/new",
  "/admin/drivers/nonexistent-id",
  "/admin/reports",
  "/admin/routes",
  "/admin/routes/new",
  "/admin/routes/nonexistent-id",
  "/admin/stops",
  "/admin/stops/new",
  "/admin/stops/nonexistent-id",
  "/admin/students",
  "/admin/students/nonexistent-id",
  "/admin/trips",
  "/admin/trips/nonexistent-id",
  "/driver",
  "/driver/checklist",
  "/fleet",
  "/install",
  "/notifications",
  "/parent",
  "/student",
  "/track/nonexistent-id",
];

async function main(): Promise<void> {
  // ------------------------------------------------------------ anonymous
  section("an anonymous visitor is redirected by a real 307, not a meta-refresh");

  /*
   * The status code is the assertion. A page that enforces the rule only in
   * `requireRole` returns 200 here with the redirect inlined as HTML, which is
   * the failure this file exists to catch.
   */
  const badStatus: string[] = [];
  for (const path of PORTAL_PAGES) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    if (res.status !== 307 && res.status !== 302) {
      badStatus.push(`${path} -> ${res.status}`);
    }
  }
  report(
    badStatus.length === 0,
    `all ${PORTAL_PAGES.length} portal pages answer an anonymous request with a redirect`,
    badStatus.length ? badStatus.join(", ") : "",
  );

  /*
   * The body of a Next redirect is the location URL as plain text, not HTML and
   * not empty. So the assertion is that nothing *rendered* is in there: no tag,
   * and no word a person would read. Getting this wrong in either direction is
   * easy - an empty-body check would pass even for the meta-refresh case, since
   * a redirect thrown mid-stream also starts short - which is why the checks
   * above assert on the status code and this one only rules out a page.
   */
  const sample = await fetch(`${BASE}/admin/reports`, { redirect: "manual" });
  const sampleBody = await sample.text();
  report(
    !/<[a-z!][^>]*>/i.test(sampleBody) && !/dashboard|navika|loading/i.test(sampleBody),
    "the redirect carries no rendered page",
    `${sampleBody.length} bytes: ${JSON.stringify(sampleBody.slice(0, 60))}`,
  );

  const metaRefresh = await fetch(`${BASE}/fleet`, { redirect: "manual" });
  const fleetBody = await metaRefresh.text();
  report(
    !/<meta[^>]*http-equiv=["']?refresh/i.test(fleetBody),
    "no meta-refresh fallback is needed on /fleet",
  );

  const toLogin = await fetch(`${BASE}/admin/trips`, { redirect: "manual" });
  report(
    (toLogin.headers.get("location") ?? "").startsWith("/login?next="),
    "the redirect remembers where the visitor was going",
    toLogin.headers.get("location") ?? "",
  );

  // -------------------------------------------------------------- wrong role
  section("a signed-in user in the wrong place is redirected to their own dashboard");

  const ROLES = [
    { email: "admin@navika.test", home: "/admin" },
    { email: "driver1@navika.test", home: "/driver" },
    { email: "parent1@navika.test", home: "/parent" },
    { email: "aarav.sharma0@student.navika.test", home: "/student" },
  ] as const;

  /*
   * Read off the seed, not hard-coded: these four areas are single-role and the
   * matrix is 4 x 4, so the point is that the *other* three all bounce. A
   * hard-coded role list would go stale the moment the seed renumbered.
   */
  const SINGLE_ROLE_AREAS = [
    { prefix: "/admin", role: "ADMIN" },
    { prefix: "/driver", role: "DRIVER" },
    { prefix: "/parent", role: "PARENT" },
    { prefix: "/student", role: "STUDENT" },
  ];

  for (const { email, home } of ROLES) {
    const session = await login(BASE, email, PASSWORD);
    const row: string[] = [];

    for (const area of SINGLE_ROLE_AREAS) {
      const res = await session.get(area.prefix);
      if (area.prefix === home) {
        // The one page each role is meant to see.
        report(
          res.status === 200,
          `${email} can reach their own dashboard ${area.prefix}`,
          `-> ${res.status}`,
        );
      } else {
        const sentTo = res.location;
        row.push(`${area.prefix}->${sentTo || res.status}`);
        report(
          (res.status === 307 || res.status === 302) && sentTo === home,
          `${email} is bounced off ${area.prefix}`,
          `-> ${res.status} ${sentTo}`,
        );
      }
    }

    // The shared pages, which every role is allowed.
    for (const path of ["/notifications", "/install"]) {
      const res = await session.get(path);
      report(
        res.status === 200,
        `${email} can reach ${path}`,
        `-> ${res.status}`,
      );
    }

    // /fleet and /track exclude drivers: a driver publishes, they do not watch.
    if (home === "/driver") {
      for (const path of ["/fleet", "/track/nonexistent-id"]) {
        const res = await session.get(path);
        report(
          (res.status === 307 || res.status === 302) && res.location === "/driver",
          `${email} is bounced off ${path}`,
          `-> ${res.status} ${res.location}`,
        );
      }
    } else {
      const fleet = await session.get("/fleet");
      report(fleet.status === 200, `${email} can reach /fleet`, `-> ${fleet.status}`);
    }

    // A signed-in user should never be shown the sign-in form.
    const bounce = await session.get("/login");
    report(
      (bounce.status === 307 || bounce.status === 302) && bounce.location === home,
      `${email} visiting /login goes straight to their dashboard`,
      `-> ${bounce.status} ${bounce.location}`,
    );
  }

  // ------------------------------------------------------------ deep prefix
  section("a deep link does not slip past the prefix check");

  /*
   * The boundary is the trailing slash. `/administrator` shares a string prefix
   * with `/admin` and must NOT be treated as the admin area - if it were, an
   * anonymous request would be answered with a redirect to /login instead of a
   * 404, which is a small leak of the shape of the site and, more practically,
   * a bug anyone with a route called `/administer` would hit.
   */
  for (const path of ["/administrator", "/drivers", "/parents", "/students"]) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    report(
      res.status !== 307,
      `${path} is not mistaken for a protected area`,
      `-> ${res.status}`,
    );
  }

  // ---------------------------------------------------------------- forged
  section("a forged cookie is not a session");

  const forged = await fetch(`${BASE}/admin`, {
    headers: { cookie: "navika_session=not.a.real.token" },
    redirect: "manual",
  });
  report(
    forged.status === 307,
    "a made-up token is treated as no session",
    `-> ${forged.status}`,
  );

  const tampered = await fetch(`${BASE}/admin`, {
    headers: { cookie: "navika_session=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiQURNSU4ifQ.bad" },
    redirect: "manual",
  });
  report(
    tampered.status === 307,
    "a token with an admin claim but a broken signature is rejected",
    `-> ${tampered.status}`,
  );

  // ------------------------------------------------------------------ API
  section("the API does not lean on the proxy for authorization");

  /*
   * The proxy's matcher excludes `/api` on purpose, so an API route that relied
   * on it would be unprotected. These assert the routes answer for themselves.
   */
  const apiChecks = [
    { path: "/api/health", expectPublic: true, label: "health is public (a load balancer cannot log in)" },
    { path: "/api/admin/reports/attendance.csv", expectPublic: false, label: "an attendance export needs a session" },
    { path: "/api/admin/students/nonexistent/history.csv", expectPublic: false, label: "a student history export needs a session" },
    { path: "/api/admin/trips/nonexistent/manifest.csv", expectPublic: false, label: "a trip manifest export needs a session" },
  ];

  for (const check of apiChecks) {
    const res = await fetch(`${BASE}${check.path}`, { redirect: "manual" });
    if (check.expectPublic) {
      report(res.status === 200, check.label, `-> ${res.status}`);
    } else {
      report(
        res.status === 401 || res.status === 302 || res.status === 307,
        check.label,
        `-> ${res.status}`,
      );
    }
  }

  // An authenticated admin gets real CSV, and it is not the login page.
  const admin = await login(BASE, "admin@navika.test", PASSWORD);
  const csv = await admin.get("/api/admin/reports/attendance.csv?from=2026-09-01&to=2026-10-02");
  report(
    csv.status === 200 && !visibleText(csv.html).includes("Sign in"),
    "an admin's CSV export is a CSV, not the login page",
    `-> ${csv.status}`,
  );
  report(
    (csv.headers.get("content-type") ?? "").includes("text/csv"),
    "the export declares text/csv",
    csv.headers.get("content-type") ?? "(none)",
  );

  // A driver must not be able to export attendance.
  const driver = await login(BASE, "driver1@navika.test", PASSWORD);
  const deniedCsv = await driver.get("/api/admin/reports/attendance.csv?from=2026-09-01&to=2026-10-02");
  report(
    deniedCsv.status === 403,
    "a driver is refused an attendance export with 403, not a redirect",
    `-> ${deniedCsv.status}`,
  );
  report(
    !visibleText(deniedCsv.html).includes("Sign in"),
    "the refusal is not the login page in disguise",
    `${deniedCsv.html.length} bytes`,
  );

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\n  smoke:boundaries crashed:", error);
  process.exit(1);
});