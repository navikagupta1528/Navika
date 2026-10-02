/**
 * Finds the first source line that makes a file unparseable.
 *
 * A stray bracket in a long file produces a parse error somewhere else entirely,
 * because the parser recovers and then reports on whatever it is holding at the
 * time. Reading backwards from that error by hand is slow and, as this script
 * exists to prove, misleading.
 *
 * So this walks every prefix. Each prefix is closed off with a generous run of
 * `}` and `)` so that a *balanced* prefix parses clean, and any diagnostic left
 * over belongs to the prefix itself rather than to truncation. The first N that
 * produces a diagnostic is where the problem was introduced.
 *
 *   node scripts/find-broken-line.mjs <file> [firstLine]
 */
import ts from "typescript";
import { readFileSync } from "node:fs";

const [file, fromArg] = process.argv.slice(2);
const lines = readFileSync(file, "utf8").split("\n");
const from = Number(fromArg ?? 1);

const CLOSERS = "}".repeat(400) + ")".repeat(400);

function diagnosticsFor(text) {
  const sf = ts.createSourceFile("probe.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  return sf.parseDiagnostics ?? [];
}

for (let n = from; n <= lines.length; n++) {
  const text = lines.slice(0, n).join("\n") + "\n" + CLOSERS;
  const diags = diagnosticsFor(text);
  if (diags.length === 0) continue;

  const first = diags[0];
  const { line } = ts.createSourceFile(
    "probe.ts",
    text,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  ).getLineAndCharacterOfPosition(first.start ?? 0);

  // The synthetic closers are past the real source, so anything reported beyond
  // the prefix is just the truncation and not the bug.
  if (line + 1 > n) continue;

  console.log(`first bad prefix ends at line ${n}`);
  for (const d of diags.slice(0, 6)) {
    const pos = d.start ?? 0;
    const at = ts.createSourceFile("p", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
      .getLineAndCharacterOfPosition(pos);
    console.log(
      `  ${at.line + 1}:${at.character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, " ")}` +
        `   | ${(lines[at.line] ?? "").trim()}`,
    );
  }
  process.exit(1);
}

console.log("no line introduces a parse error");
