/**
 * Page auditor: visits every route as every role in a real browser and reports
 * what is actually wrong with it.
 *
 *   npm run audit
 *   npm run audit 3010
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything else in this repo tests one thing at a time. `smoke:boundaries` checks
 * status codes, `smoke:auth` checks copy, the unit tests check arithmetic. None of
 * them load a page in a browser, which is where a whole category of defect lives:
 *
 *   - A React hydration mismatch logs a warning in the console and then silently
 *     re-renders the whole subtree. The page looks fine. The status is 200. The
 *     server-rendered HTML is discarded. Nothing else in this repo can see it.
 *   - A `useEffect` that throws on mount takes the component out of the tree with
 *     no error boundary in the way, and the page renders a hole.
 *   - An image or script 404s, or a request is aborted, and the page still renders.
 *   - An accessibility violation that only exists once a dialog is open, or after
 *     hydration has attached the ARIA attributes the server did not send.
 *
 * All of these are invisible to a status code and obvious to a browser. This is the
 * suite that looks at the browser.
 *
 * WHAT IT REPORTS
 * ---------------
 * Per route per role: console errors and warnings, uncaught exceptions, failed and
 * >=400 responses, hydration warnings specifically, axe-core accessibility
 * violations, and layout shift. Roles are separate passes because most of these
 * bugs are role-specific - a component that reads a field only ADMIN has is fine on
 * every other page.
 *
 * A deliberately loose starting threshold: report everything, then decide what is
 * worth fixing. A threshold set before looking is a threshold set to be satisfied.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import puppeteer, {
  type Browser,
  type ConsoleMessage,
  type HTTPRequest,
  type HTTPResponse,
  type Page,
} from "puppeteer-core";
import { PrismaClient } from "../src/generated/prisma/client";

import { DEMO_PASSWORD, resolveBase } from "./lib/http";

const BASE = resolveBase();

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const AXE = readFileSync(
  resolve(process.cwd(), "node_modules/axe-core/axe.min.js"),
  "utf8",
);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ROLES = [
  { name: "ADMIN", email: "admin@navika.test" },
  { name: "DRIVER", email: "driver1@navika.test" },
  { name: "PARENT", email: "parent1@navika.test" },
  { name: "STUDENT", email: "aarav.sharma0@student.navika.test" },
] as const;

/** Routes each role is expected to be able to open. */
const ROUTES: Record<string, string[]> = {
  ADMIN: [
    "/admin",
    "/admin/students",
    "/admin/students?q=aarav",
    "/admin/students?page=2",
    "/admin/students?page=99",
    "/admin/students?q=zzzznomatch",
    "/admin/trips",
    "/admin/trips?status=COMPLETED",
    "/admin/trips?date=2020-01-01",
    "/admin/alerts",
    "/admin/alerts?status=OPEN",
    "/admin/alerts?status=RESOLVED",
    "/admin/buses",
    "/admin/buses/new",
    "/admin/drivers",
    "/admin/drivers/new",
    "/admin/routes",
    "/admin/routes/new",
    "/admin/stops",
    "/admin/stops/new",
    "/admin/reports",
    "/fleet",
    "/notifications",
    "/install",
  ],
  DRIVER: ["/driver", "/driver/checklist", "/notifications", "/install"],
  PARENT: ["/parent", "/notifications", "/install"],
  STUDENT: ["/student", "/notifications", "/install"],
};

/** Public pages, checked once with no session at all. */
const PUBLIC = ["/login", "/register"];

/**
 * The HMR websocket id changes on every reconnect, so it has to be normalised out
 * before deduplication - otherwise one broken dev-mode socket produces one finding
 * per route and buries the real ones.
 */
function normalise(detail: string): string {
  return detail.replace(/id=[A-Za-z0-9_-]+/g, "id=<varies>");
}

type Finding = {
  route: string;
  role: string;
  kind: string;
  detail: string;
};

const findings: Finding[] = [];
const visited: { role: string; route: string; status: number | null; ms: number }[] = [];

function add(route: string, role: string, kind: string, rawDetail: string) {
  const detail = normalise(rawDetail);
  // One identical finding per route per kind: a component in a list reports the
  // same thing forty times and the repetition hides the other thirty-nine.
  if (findings.some((f) => f.route === route && f.role === role && f.kind === kind && f.detail === detail))
    return;
  findings.push({ route, role, kind, detail });
}

/**
 * Drop every cookie, so the next sign-in starts anonymous.
 *
 * Uses `page.deleteCookie` with the cookies actually present rather than a raw CDP
 * call. The CDP version appeared to work and did not: `/login` redirects an
 * authenticated visitor to their dashboard, so the next sign-in landed on `/admin`,
 * found no form, and failed with a message that pointed at the login page rather
 * than at the session that was still there. Reading the cookie jar back and
 * deleting what is in it cannot silently do nothing.
 */
async function signOut(page: Page) {
  const cookies = await page.cookies();
  if (cookies.length > 0) {
    await page.deleteCookie(...cookies);
  }
  const left = await page.cookies();
  if (left.length > 0) {
    throw new Error(
      `sign-out left ${left.length} cookie(s) behind: ${left.map((c) => c.name).join(", ")}`,
    );
  }
}

/** Log in through the real form, so the session is a real one. */
async function signIn(page: Page, email: string) {
  await signOut(page);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

  // Wait for the selector rather than trusting `domcontentloaded`: Next streams the
  // shell first and the form later, so the element can legitimately be absent a
  // moment after the document has "loaded".
  try {
    await page.waitForSelector("#email", { timeout: 20_000 });
  } catch {
    const snapshot = await page.content().catch(() => "<could not read the page>");
    throw new Error(
      `login form never rendered for ${email}. ` +
        `url=${page.url()} title=${await page.title()} length=${snapshot.length}. ` +
        `First 600 chars:\n${snapshot.slice(0, 600)}`,
    );
  }

  await page.type("#email", email);
  await page.type("#password", DEMO_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);

  // A sign-in that silently failed would make every later route look like an
  // authorization failure, which is a far more expensive thing to debug.
  if (page.url().includes("/login")) {
    const message = await page.$eval('[role="alert"]', (el) => el.textContent).catch(() => null);
    throw new Error(
      `sign-in did not redirect for ${email}; still on ${page.url()}` +
        (message ? `, page said "${message}"` : ""),
    );
  }
}

/**
 * Visit one route and collect everything.
 *
 * Waits for `networkidle2` rather than `load` because most of the interesting
 * failures here - a chunk that 404s, an aborted request, an effect that throws -
 * happen *after* load, and a load-event snapshot would report a clean page.
 */
async function visit(page: Page, route: string, role: string) {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    const text = msg.text();
    const line = `${msg.type()}: ${text}`;
    if (msg.type() === "error") consoleErrors.push(line);
    // `ConsoleMessageType` spells the level "warn", not "warning". Checked with
    // `startsWith` so a future level like "warning" is still caught.
    else if (msg.type().startsWith("warn")) consoleWarnings.push(line);
  };
  const onPageError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    pageErrors.push(`uncaught: ${message}`);
  };
  const onRequestFailed = (req: HTTPRequest) => {
    // Aborts are normal here: React and the router cancel in-flight requests on
    // navigation, and Socket.IO probes that fail are not a page defect.
    const reason = req.failure()?.errorText ?? "";
    if (reason.includes("net::ERR_ABORTED")) return;
    failedRequests.push(`${req.url()} - ${reason}`);
  };
  const onResponse = (res: HTTPResponse) => {
    if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  const started = Date.now();
  let status: number | null = null;
  try {
    const res = await page.goto(`${BASE}${route}`, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });
    status = res?.status() ?? null;
    // Give client effects a beat to run and fail. A hydration mismatch or a
    // throwing effect logs after the load event, not during it.
    await new Promise((r) => setTimeout(r, 600));

    // Layout shift, measured live. A jumping page is not an error, but it is the
    // thing that makes a dashboard feel cheap, so it is worth seeing the numbers.
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          try {
            const po = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const e = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
                if (!e.hadRecentInput) total += e.value ?? 0;
              }
            });
            po.observe({ type: "layout-shift", buffered: true });
            setTimeout(() => {
              po.disconnect();
              resolve(total);
            }, 700);
          } catch {
            resolve(0);
          }
        }),
    );
    if (cls > 0.1) {
      add(route, role, "layout-shift", `CLS ${cls.toFixed(3)} (over the 0.1 "good" line)`);
    }

    // axe-core, injected as a script tag and run against the live DOM.
    //
    // `addScriptTag` rather than `page.evaluate(source)`: evaluate runs a string as
    // an *expression*, so axe-core's own top-level code is fine but the `return`
    // that follows it is an illegal return statement, and every route then reports
    // "Illegal return statement" as if the page were broken.
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axeApi = (globalThis as any).axe;
      if (!axeApi) return [];
      const res = await axeApi.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      });
      return res.violations.map((v: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        count: v.nodes.length,
        example: v.nodes[0]?.target.join(" ") ?? "",
      }));
    });
    for (const v of violations) {
      add(
        route,
        role,
        `a11y:${v.id}`,
        `${v.count} node(s), impact ${v.impact ?? "unknown"} - ${v.help}${v.example ? ` [e.g. ${v.example}]` : ""}`,
      );
    }
  } catch (e) {
    add(route, role, "navigation", `threw: ${(e as Error).message}`);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
  }

  for (const e of pageErrors) add(route, role, "page-error", e);
  for (const e of consoleErrors) {
    const hydration = /hydrat|did not match|Text content does not match|server rendered/i.test(e);
    add(route, role, hydration ? "hydration" : "console-error", e);
  }
  for (const e of consoleWarnings) {
    // React's own key warnings and act() advice are worth seeing, not hiding.
    add(route, role, "console-warning", e);
  }
  for (const e of failedRequests) add(route, role, "request-failed", e);
  for (const e of badResponses) add(route, role, "bad-response", e);

  visited.push({ role, route, status, ms: Date.now() - started });
}

async function main() {
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        // A deterministic viewport, so layout-shift numbers mean something.
        "--window-size=1440,900",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

    for (const route of PUBLIC) await visit(page, route, "ANONYMOUS");

    for (const role of ROLES) {
      await signIn(page, role.email);
      for (const route of ROUTES[role.name]) await visit(page, route, role.name);
    }

    /*
     * DYNAMIC ROUTES
     *
     * `[id]` pages need real ids, and hard-coding them would make the suite rot the
     * first time the database is reseeded. Pulled from the database, and skipped
     * with a note when a table is empty rather than reporting a 404 as a defect.
     */
    const [bus, driver, routeRow, stop, trip, student] = await Promise.all([
      prisma.bus.findFirst({ select: { id: true } }),
      prisma.driverProfile.findFirst({ select: { id: true } }),
      prisma.route.findFirst({ select: { id: true } }),
      prisma.stop.findFirst({ select: { id: true } }),
      prisma.trip.findFirst({ select: { id: true } }),
      prisma.studentProfile.findFirst({ select: { id: true } }),
    ]);

    await signIn(page, "admin@navika.test");
    const dynamic: [string, string | undefined][] = [
      ["/admin/buses/", bus?.id],
      ["/admin/drivers/", driver?.id],
      ["/admin/routes/", routeRow?.id],
      ["/admin/stops/", stop?.id],
      ["/admin/trips/", trip?.id],
      ["/admin/students/", student?.id],
      ["/admin/buses/", "does-not-exist"],
      ["/admin/trips/", "does-not-exist"],
    ];
    for (const [prefix, id] of dynamic) {
      if (!id) continue;
      await visit(page, `${prefix}${id}`, "ADMIN");
    }

    /* TRACKING, AS EVERY ROLE WHO CAN OPEN IT */
    const liveTrip = await prisma.trip.findFirst({
      where: { status: "ONGOING" },
      select: { busId: true },
    });
    if (liveTrip) {
      for (const role of ROLES) {
        await signIn(page, role.email);
        await visit(page, `/track/${liveTrip.busId}`, role.name);
      }
    }

    await page.close();
  } finally {
    await browser?.close();
    await prisma.$disconnect();
  }

  /* ------------------------------------------------------------------ */
  /* Report                                                              */
  /* ------------------------------------------------------------------ */

  console.log("");
  console.log(`Visited ${visited.length} route/role combinations.`);

  const byRoute = new Map<string, { ms: number; n: number }>();
  for (const v of visited) {
    const e = byRoute.get(v.route) ?? { ms: 0, n: 0 };
    e.ms += v.ms;
    e.n += 1;
    byRoute.set(v.route, e);
  }
  const slowest = [...byRoute.entries()]
    .map(([route, e]) => ({ route, avg: Math.round(e.ms / e.n) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);
  console.log("");
  console.log("Slowest routes (average ms, headless, so generous):");
  for (const s of slowest) console.log(`  ${String(s.avg).padStart(6)}  ${s.route}`);

  if (findings.length === 0) {
    console.log("");
    console.log("No console errors, page errors, failed requests, 4xx/5xx responses,");
    console.log("hydration warnings, accessibility violations or layout shift found.");
    return;
  }

  const kinds = new Map<string, Finding[]>();
  for (const f of findings) {
    const k = kinds.get(f.kind) ?? [];
    k.push(f);
    kinds.set(f.kind, k);
  }

  console.log("");
  console.log(`${findings.length} distinct problems across ${kinds.size} kinds:`);
  console.log("");

  // Errors first, then a11y, then advice: the ordering is how they should be read.
  const severity = (k: string) =>
    k.startsWith("page-error") || k.startsWith("console-error") || k.startsWith("hydration")
      ? 0
      : k.startsWith("bad-response") || k.startsWith("navigation") || k.startsWith("request-failed")
        ? 1
        : k.startsWith("a11y")
          ? 2
          : 3;

  for (const kind of [...kinds.keys()].sort((a, b) => severity(a) - severity(b) || a.localeCompare(b))) {
    const group = kinds.get(kind)!;
    console.log(`  ${kind}  (${group.length})`);
    for (const f of group) {
      console.log(`    ${f.role.padEnd(9)} ${f.route}`);
      console.log(`      ${f.detail}`);
    }
    console.log("");
  }

  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
