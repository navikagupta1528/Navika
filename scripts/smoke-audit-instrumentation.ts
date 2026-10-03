/**
 * Does the layout-shift instrumentation actually fire?
 *
 * A check that reports zero is only worth anything if it can report non-zero. The
 * shape of the code has already lied once - the observer was installed per visit
 * and multiplied every total by the number of routes already audited - so the
 * honest thing is to break something on purpose and confirm the audit notices.
 *
 * Shift: insert a tall block at the top of a page once the load has finished. It
 * pushes everything below it down, which is precisely what a real shift looks like
 * to the observer. The block is inserted at `DOMContentLoaded + 300ms`, which is
 * after the audit's settle, so a missed measurement cannot be blamed on timing.
 */
import "dotenv/config";

import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:3010";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // Errors inside an `evaluateOnNewDocument` callback are swallowed by the
  // browser unless something is listening, so listen.
  page.on("pageerror", (err: unknown) =>
    console.log(`  [pageerror] ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`),
  );
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console] ${m.text().slice(0, 160)}`);
  });

  // Exactly the registration `main` in audit-pages.ts performs.
  //
  // No inner arrow is ever bound to a `const` here. tsx transpiles this file with
  // esbuild's `keepNames`, which rewrites `const f = () => {}` into
  // `__name(() => {}, "f")`; `__name` does not exist in the browser, so the whole
  // callback dies on that line. That is not a hypothetical - it is exactly what
  // made the first version of the audit report a clean 0.000 on every route while
  // the observer was never attached.
  await page.evaluateOnNewDocument(() => {
    const w = window as unknown as { __cls: number; __clsAttached: boolean; __clsError?: string };
    w.__cls = 0;
    w.__clsAttached = false;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
          if (!e.hadRecentInput) w.__cls += e.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
      w.__clsAttached = true;
    } catch (err) {
      w.__clsError = String(err);
    }
  });

  // Break the page deliberately: a tall block at the top of the body, inserted
  // after load, which pushes everything below it down.
  await page.evaluateOnNewDocument(() => {
    const w = window as unknown as { __injected?: string };
    w.__injected = "script-ran";
    document.addEventListener("DOMContentLoaded", () => {
      w.__injected = "domcontentloaded";
      setTimeout(() => {
        try {
          if (!document.body) {
            w.__injected = "no-body";
            return;
          }
          const block = document.createElement("div");
          block.id = "injected-shifter";
          block.style.height = "420px";
          block.style.background = "#fde68a";
          document.body.insertBefore(block, document.body.firstChild);
          w.__injected = document.body.contains(block) ? "inserted" : "insert-failed";
        } catch (err) {
          w.__injected = "threw: " + String(err);
        }
      }, 300);
    });
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  console.log(`  landed on                ${new URL(page.url()).pathname}`);

  // The audit's own sequence: 600ms, read, 1200ms, read.
  await new Promise((r) => setTimeout(r, 600));
  const early = await page.evaluate(() => (window as unknown as { __cls: number }).__cls ?? 0);
  await new Promise((r) => setTimeout(r, 1_200));
  const settled = await page.evaluate(() => (window as unknown as { __cls: number }).__cls ?? 0);

  const probe = await page.evaluate(() => {
    const w = window as unknown as { __injected?: string; __clsAttached?: boolean };
    return {
      injected: w.__injected ?? "(never ran)",
      attached: w.__clsAttached === true,
      present: !!document.querySelector("#injected-shifter"),
      bodyChildren: document.body?.children.length ?? 0,
    };
  });
  const detected = settled > 0.1;
  const checks: [string, boolean][] = [
    ["the observer attached", probe.attached],
    ["the injected block reached the DOM", probe.present],
    ["the injected block was traced to 'inserted'", probe.injected === "inserted"],
    [`a deliberate shift was measured (${settled.toFixed(3)} > 0.1)`, detected],
  ];
  const ok = checks.every(([, pass]) => pass);

  console.log(`  observer attached        ${probe.attached ? "yes" : "no"}`);
  console.log(`  injection trace          ${probe.injected}`);
  console.log(`  injected block present   ${probe.present ? "yes" : "no"}`);
  console.log(`  body children            ${probe.bodyChildren}`);
  console.log(`  CLS at +600ms            ${early.toFixed(3)}`);
  console.log(`  CLS at +1800ms           ${settled.toFixed(3)}`);
  console.log(`  threshold                0.100`);
  for (const [label, pass] of checks) console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);

  console.log(
    `\n  ${ok ? "PASS" : "FAIL"}: a zero from this audit means zero` +
      (ok ? "" : " - and until this passes, every 'no layout shift' is meaningless"),
  );

  await browser.close();
  if (!detected) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
