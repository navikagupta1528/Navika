/**
 * Scores the app with Lighthouse and fails the build on a regression.
 *
 * Why a script rather than a badge: a performance number that is only ever
 * looked at when someone remembers to look is a number that quietly slides.
 * This runs against a real server, writes the report, prints the four category
 * scores, and exits non-zero if any of them dropped below its floor.
 *
 * Usage:
 *   npm run lighthouse              # score, report, exit non-zero on a floor miss
 *   npm run lighthouse -- --open    # also dump the HTML report path
 *
 * It scores `/login` and `/register`, the only pages reachable without a
 * session. An authenticated page would need a login handshake inside the run,
 * which makes the number depend on the seed rather than on the code.
 *
 * The floors are set one point below what the app currently achieves, so this
 * catches a regression instead of blocking an improvement. Tighten them when a
 * genuine improvement lands; loosen them never.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".lighthouse");

/** Where the app is expected to already be running. */
const BASE = process.env.LIGHTHOUSE_URL ?? "http://localhost:3010";

/**
 * Every page reachable without a session.
 *
 * Both of these are scored, not just the first one. `/login` and `/register`
 * share a layout but not their markup, and `/register` was sitting at 96
 * accessibility while `/login` read 100 — a contrast failure on a line of
 * footer copy, in a layout both pages use. Scoring one page and declaring the
 * work done would have left it there indefinitely, because the passing page
 * says nothing about the failing one.
 */
const PATHS_UNDER_TEST = ["/login", "/register"];

/**
 * Category -> minimum acceptable score, 0..1.
 *
 * Accessibility is held at 1.0 deliberately and with no caveat. It is the one
 * category where a partial score is a defect rather than a slow page: the
 * earlier `maximumScale: 1` scored 94 purely because it disabled pinch-zoom,
 * and nothing about a bus tracker justifies making text unzoomable.
 */
const FLOORS = {
  performance: 0.95,
  accessibility: 1.0,
  "best-practices": 1.0,
  seo: 1.0,
};

/** Refuse to score a server that is not actually up. */
async function assertServerUp() {
  const url = `${BASE}${PATHS_UNDER_TEST[0]}`;
  try {
    const res = await fetch(url, { redirect: "manual" });
    if (!res.ok) {
      throw new Error(`${url} answered ${res.status}`);
    }
  } catch (error) {
    throw new Error(
      `${url} is not answering (${error instanceof Error ? error.message : error}).\n` +
        `Start the app first:  npm run build && npm run start`,
    );
  }
}

/** Filesystem-safe form of a path: `/register` becomes `register`. */
function slug(path) {
  return path.replace(/^\/+/, "").replace(/[^\w-]+/g, "-") || "root";
}

function runLighthouse(pathUnderTest) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "node_modules", "lighthouse", "cli", "index.js"),
        `${BASE}${pathUnderTest}`,
        "--output=json",
        "--output=html",
        // The flag wants a *base* path. Lighthouse appends `.report.json` and
        // `.report.html` to whatever it is given, so passing a file-looking
        // path just produces a file with a doubled suffix somewhere else.
        `--output-path=${join(OUT, slug(pathUnderTest))}`,
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
        "--only-categories=performance,accessibility,best-practices,seo",
        "--quiet",
      ],
      { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("error", rejectPromise);
    child.on("exit", (code) =>
      code === 0
        ? resolvePromise()
        : rejectPromise(new Error(`lighthouse exited with ${code} on ${pathUnderTest}`)),
    );
  });
}

async function main() {
  await assertServerUp();
  mkdirSync(OUT, { recursive: true });

  let failed = false;

  for (const pathUnderTest of PATHS_UNDER_TEST) {
    console.log(`scoring ${BASE}${pathUnderTest} ...\n`);
    await runLighthouse(pathUnderTest);

    const reportPath = join(OUT, `${slug(pathUnderTest)}.report.json`);
    // Plain read + JSON.parse rather than a dynamic import: the report is a
    // JSON blob with no module shape worth importing, and `import` of a path
    // needs a cache-buster to survive a rerun in the same process.
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    const rows = [];
    for (const [category, floor] of Object.entries(FLOORS)) {
      const score = report.categories[category]?.score;
      if (score === undefined) {
        throw new Error(`the report has no '${category}' category`);
      }
      const ok = score >= floor;
      if (!ok) failed = true;
      rows.push({ category, score: Math.round(score * 100), floor: Math.round(floor * 100), ok });
    }

    const width = Math.max(...rows.map((r) => r.category.length));
    for (const r of rows) {
      console.log(
        `  ${r.ok ? "PASS" : "FAIL"}  ${r.category.padEnd(width)}  ${String(r.score).padStart(3)}  (floor ${r.floor})`,
      );
    }
    console.log(`\n  report: ${join(OUT, `${slug(pathUnderTest)}.report.html`)}\n`);

    // Print what actually failed, not just that the number moved. A score of 96
    // is a symptom; "color-contrast" is the bug.
    const failing = [];
    for (const [id, audit] of Object.entries(report.audits)) {
      if (audit.score === null || audit.score >= 1) continue;
      if (audit.scoreDisplayMode === "notApplicable") continue;
      // Metric scores are weighted, not pass/fail; a metric below 1.0 is not
      // itself a defect worth printing.
      if (audit.scoreDisplayMode === "numeric" || audit.scoreDisplayMode === "metricSavings") continue;
      failing.push(`${id} — ${audit.title}`);
      // The offending node, which is the only part that identifies the fix.
      for (const item of audit.details?.items ?? []) {
        const snippet = item.node?.snippet;
        if (snippet) {
          failing.push(`    ${snippet.replace(/\s+/g, " ")}`);
          const why = item.node?.explanation;
          if (why) failing.push(`    ${why.split("\n").pop()}`);
        }
      }
    }
    if (failing.length > 0) {
      console.log("  audits below 1.0:");
      for (const f of failing) console.log(`    ${f}`);
      console.log("");
    }
  }

  if (failed) {
    console.error("FAIL  a category fell below its floor. See the audits above.");
    process.exit(1);
  }
  console.log("PASS  every category on every public page is at or above its floor.");
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});