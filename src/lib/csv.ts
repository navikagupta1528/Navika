/**
 * CSV generation. Pure functions, no server-only import, no database.
 *
 * Kept separate from the route handlers that use it for the same reason
 * `tracking.ts` and `health.ts` are separate: the part that can be wrong quietly
 * is the escaping, and it has to be provable rather than eyeballed.
 */

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * A student called `=HYPERLINK("http://evil","click")` is a legal name. Written
 * into a CSV and opened in Excel or LibreOffice, it is not text any more - it is
 * a link the person opening the attendance sheet is invited to click. The name
 * comes from a form an admin filled in, and the sheet is exactly what gets
 * emailed around a college, so this is a real path, not a hypothetical one.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/** Below this, every spreadsheet still guesses the type and mangles a leading zero. */
export const FORCE_TEXT_PREFIX = "'";

/** Excel's hard ceiling; a spreadsheet that hits it shows ### and truncates. */
export const EXCEL_CELL_CHAR_LIMIT = 32_767;

export type Cell = string | number | boolean | null | undefined;

/** The BOM, as the bytes a UTF-8 encoder would produce for U+FEFF. */
export const UTF8_BOM = "﻿";

/**
 * Escape one value into a CSV field.
 *
 * Quoting alone is not enough. RFC 4180 says a field containing a quote must be
 * wrapped in quotes with the quote doubled, and the wrapping quotes are only
 * *necessary* when the value contains a comma, a quote, or a newline - so a
 * value that happens to start with `=` but contains no comma needs no quotes,
 * and is then read back by Excel as a formula. The two defences are independent
 * and both are applied.
 */
export function escapeCsvValue(input: Cell): string {
  if (input === null || input === undefined) return "";

  let value = typeof input === "string" ? input : String(input);

  // Normalise line endings and strip the characters that would either break
  // the row or hide a formula prefix from the check below.
  value = value.replace(/\r\n?/g, "\n").replace(/\t/g, " ");

  if (value.length > EXCEL_CELL_CHAR_LIMIT) {
    value = `${value.slice(0, EXCEL_CELL_CHAR_LIMIT - 1)}…`;
  }

  /*
   * The check is against the value with leading whitespace removed, not against
   * the value as written.
   *
   * Two earlier versions got this wrong in opposite directions. One listed `\r`
   * as a dangerous prefix while normalising it to `\n` two lines earlier, so a
   * leading CR walked straight past the guard. The other normalised a leading
   * tab to a space and then compared against prefixes that no longer matched, so
   * `\t=1+1` was protected only because the leftover space happened to force the
   * field to be quoted - correct by accident, and it would have stopped being
   * correct the moment another rule changed. Trimming first means the guard is
   * the reason these are safe rather than a coincidence.
   */
  const needsFormulaGuard = FORMULA_PREFIXES.some((prefix) =>
    value.trimStart().startsWith(prefix),
  );
  if (needsFormulaGuard) {
    value = `${FORCE_TEXT_PREFIX}${value}`;
  }

  const mustQuote =
    /["\n,]/.test(value) || value !== value.trim() || value.startsWith(FORCE_TEXT_PREFIX);

  if (!mustQuote) return value;

  return `"${value.replace(/"/g, '""')}"`;
}

/** One row. A completely empty row is still emitted, so a gap is visible. */
export function csvRow(cells: readonly Cell[]): string {
  return cells.map(escapeCsvValue).join(",");
}

export type CsvOptions = {
  /** Emit the UTF-8 BOM. Correct for Excel, wrong for a test comparison. */
  bom?: boolean;
  /** Row terminator. `\r\n` for files, `\n` when a test wants to compare lines. */
  newline?: "\r\n" | "\n";
};

/**
 * Build a whole document.
 *
 * Row terminator defaults to CRLF because that is what RFC 4180 specifies and
 * what Excel on Windows expects; a `\n`-only file opens with the last field of
 * each row visibly joined to the first of the next one on some setups.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly Cell[])[],
  options: CsvOptions = {},
): string {
  const { bom = true, newline = "\r\n" } = options;
  const lines = [csvRow(header), ...rows.map((r) => csvRow(r))];
  return `${bom ? UTF8_BOM : ""}${lines.join(newline)}${newline}`;
}

/**
 * A filename that survives a header, a download shelf and a colleague's rename.
 *
 * The `date` in the report title is untrusted input as far as this function is
 * concerned, so every character that could split a header, terminate a path or
 * confuse a shell is removed rather than assumed away.
 */
export function safeDownloadFilename(name: string): string {
  const cleaned = name
    // A quote or CR/LF lets a caller break out of a quoted filename header.
    .replace(/[\r\n"']/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);

  return cleaned.length > 0 ? cleaned : "navika-export.csv";
}

/**
 * The `Content-Disposition` value for an attachment.
 *
 * Both forms are emitted deliberately. `filename=` is what a browser on a Latin-1
 * assumption will use, and `filename*=UTF-8''` is RFC 5987, which is what
 * everything current actually reads. Sending only the first one mangles a Hindi
 * or Marathi student name into replacement characters on download.
 */
export function contentDisposition(filename: string): string {
  const safe = safeDownloadFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
