import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  csvRow,
  EXCEL_CELL_CHAR_LIMIT,
  escapeCsvValue,
  FORCE_TEXT_PREFIX,
  safeDownloadFilename,
  toCsv,
  UTF8_BOM,
} from "./csv";

/**
 * An independent CSV reader, written to the RFC rather than to the writer above.
 *
 * The earlier version of this file asserted on raw strings and on
 * `row.split(",")`. Both are the wrong tool: a quoted field legitimately still
 * contains a comma character, so `split(",")` reports three fields for a row
 * that has two, and the test then "proves" the escaping is broken when it is
 * actually working. Asserting on parsed fields is what the guarantee is really
 * about - the row still has the columns it was given.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Strips the text marker a spreadsheet applies, recovering the original value. */
function asSpreadsheetText(value: string): string {
  return value.startsWith(FORCE_TEXT_PREFIX) ? value.slice(FORCE_TEXT_PREFIX.length) : value;
}

/**
 * What the writer is documented to do to a value before escaping: normalise line
 * endings, and turn tabs into spaces. Written out here rather than imported, so
 * the test pins the documented behaviour instead of restating the implementation.
 */
function normalizedForCsv(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
}

/**
 * What a person reading the sheet in Excel ends up with: the value, minus the
 * text marker the spreadsheet consumes.
 *
 * Note this does not restore the tab or CR that normalisation replaced. That
 * loss is deliberate - a raw tab inside a quoted CSV field is how rows get
 * mangled by half the parsers in existence - so the guarantee under test is
 * that the *normalised* value survives, not the original bytes.
 */
function recoverOriginal(field: string): string {
  return asSpreadsheetText(field);
}

describe("escapeCsvValue", () => {
  it("passes ordinary text through untouched", () => {
    expect(escapeCsvValue("Aarav Sharma")).toBe("Aarav Sharma");
    expect(escapeCsvValue("Class 3B")).toBe("Class 3B");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvValue("Sharma, Aarav")).toBe('"Sharma, Aarav"');
  });

  it("doubles an embedded quote, per RFC 4180", () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  it("keeps a newline inside the field rather than ending the row", () => {
    expect(escapeCsvValue("line one\nline two")).toBe('"line one\nline two"');
  });

  it("normalises CRLF so one logical field never becomes two rows", () => {
    expect(parseCsv(csvRow(["a\r\nb"]))).toEqual([["a\nb"]]);
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
    // "null" in an attendance sheet reads as a value somebody typed.
    expect(escapeCsvValue(null)).not.toBe("null");
  });

  it("keeps a zero", () => {
    // A falsy check here would have produced an empty cell for 0 pickups.
    expect(escapeCsvValue(0)).toBe("0");
    expect(escapeCsvValue(false)).toBe("false");
  });

  describe("formula injection", () => {
    // Every one of these is a legal name or note a college could genuinely have.
    // Written raw into a CSV and opened in a spreadsheet, each one executes.
    const attacks = [
      '=HYPERLINK("http://evil.example","click")',
      "+1+1",
      "-1+1",
      "@SUM(A1:A9)",
      "\t=1+1",
      "\r=1+1",
      "\r\n=1+1",
    ];

    for (const attack of attacks) {
      it(`neutralises ${JSON.stringify(attack)}`, () => {
        const parsed = parseCsv(csvRow([attack]));
        // The whole value must come back in one field, not be split.
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toHaveLength(1);

        const [field] = parsed[0]!;
        // The dangerous character must no longer be the first thing the
        // spreadsheet reads...
        expect(field.startsWith(FORCE_TEXT_PREFIX)).toBe(true);
        // ...and the value must have survived intact behind it, rather than
        // being dropped or truncated. Recovering the original is the real
        // guarantee; blocking the formula is only half of it.
        expect(recoverOriginal(field!)).toBe(normalizedForCsv(attack));
      });
    }

    it("guards even when quoting alone would not have been enough", () => {
      // "=1+1" has no comma, no quote and no newline. A quoting-only defence
      // emits it bare, and it evaluates. This is the case that is easy to miss.
      expect(escapeCsvValue("=1+1")).toContain(`${FORCE_TEXT_PREFIX}=1+1`);
    });

    it("does not guard a value whose first character merely looks dangerous later on", () => {
      // The check is about position, not substring. Guarding these would corrupt
      // ordinary names.
      expect(escapeCsvValue("Ram=Das")).toBe("Ram=Das");
      expect(escapeCsvValue("A+B")).toBe("A+B");
      expect(escapeCsvValue("A@B")).toBe("A@B");
    });

    it("preserves a leading zero on an identifier", () => {
      const parsed = parseCsv(csvRow(["-007"]));
      expect(asSpreadsheetText(parsed[0]![0]!)).toBe("-007");
    });
  });

  it("truncates at Excel's cell limit rather than corrupting the file", () => {
    const huge = "x".repeat(EXCEL_CELL_CHAR_LIMIT + 500);
    const out = escapeCsvValue(huge);
    expect(out.length).toBe(EXCEL_CELL_CHAR_LIMIT);
    expect(out.endsWith("…")).toBe(true);
  });

  it("quotes a value with leading or trailing space, which a parser would otherwise eat", () => {
    expect(parseCsv(csvRow([" Aarav"]))).toEqual([[" Aarav"]]);
    expect(parseCsv(csvRow(["Aarav "]))).toEqual([["Aarav "]]);
  });
});

describe("csvRow", () => {
  it("keeps a comma inside one field from becoming two columns", () => {
    // The guarantee is about parsed columns, not about the absence of a comma
    // character - a correctly quoted field still contains one.
    expect(parseCsv(csvRow(["Sharma, Aarav", "NB-101"]))).toEqual([
      ["Sharma, Aarav", "NB-101"],
    ]);
  });

  it("keeps the column count even when a cell contains a newline", () => {
    // The failure this prevents is the worst kind: not an error, but a row that
    // silently becomes two short rows in the middle of an attendance file.
    expect(parseCsv(csvRow(["a\nb", "c"]))).toEqual([["a\nb", "c"]]);
  });

  it("round-trips a row of mixed types", () => {
    expect(parseCsv(csvRow(["Aarav", 12, true, null]))).toEqual([["Aarav", "12", "true", ""]]);
  });
});

describe("toCsv", () => {
  it("emits a header, then the rows", () => {
    const out = toCsv(["name", "bus"], [["Aarav", "NB-101"]], { bom: false, newline: "\n" });
    expect(parseCsv(out)).toEqual([
      ["name", "bus"],
      ["Aarav", "NB-101"],
    ]);
  });

  it("emits only the header for an empty result set", () => {
    // A completely empty file is indistinguishable from a failed export.
    const out = toCsv(["name"], [], { bom: false, newline: "\n" });
    expect(parseCsv(out)).toEqual([["name"]]);
  });

  it("starts with a BOM by default so Excel opens UTF-8 correctly", () => {
    expect(toCsv(["name"], []).startsWith(UTF8_BOM)).toBe(true);
  });

  it("omits the BOM on request", () => {
    expect(toCsv(["name"], [], { bom: false }).startsWith(UTF8_BOM)).toBe(false);
  });

  it("uses CRLF by default", () => {
    expect(toCsv(["a"], [["1"]], { bom: false })).toContain("\r\n");
  });

  it("keeps every row the same width even with hostile values", () => {
    const rows = [
      ["=cmd|'/c calc'!A1", "NB-101"],
      ["Sharma, Aarav", "NB-102"],
      ['He said "on time"', "NB-103"],
      ["line\nbreak", "NB-104"],
    ];
    const parsed = parseCsv(toCsv(["name", "bus"], rows));
    // Every row has the header's column count. A ragged export means a name
    // shifted every value after it by one column.
    for (const row of parsed) expect(row).toHaveLength(2);
  });
});

describe("safeDownloadFilename", () => {
  it("keeps a plain name", () => {
    expect(safeDownloadFilename("attendance.csv")).toBe("attendance.csv");
  });

  it("strips a path separator so a name cannot climb out of a downloads folder", () => {
    expect(safeDownloadFilename("../../etc/passwd")).not.toContain("..");
    expect(safeDownloadFilename("../../etc/passwd")).not.toContain("/");
  });

  it("removes quotes and newlines that would break out of a header", () => {
    const out = safeDownloadFilename('a"\r\nSet-Cookie: x=1');
    expect(out).not.toContain('"');
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\r");
  });

  it("falls back rather than returning an empty filename", () => {
    // An empty Content-Disposition filename makes some browsers save the file as
    // "download", or refuse the download entirely.
    expect(safeDownloadFilename("///")).toBe("navika-export.csv");
    expect(safeDownloadFilename("")).toBe("navika-export.csv");
  });

  it("collapses runs of punctuation left behind by stripping", () => {
    expect(safeDownloadFilename("a   b")).toBe("a-b");
  });

  it("caps the length", () => {
    expect(safeDownloadFilename("a".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe("contentDisposition", () => {
  it("marks the response as an attachment", () => {
    expect(contentDisposition("report.csv")).toContain('attachment; filename="report.csv"');
  });

  it("sends an ASCII fallback as well as the RFC 5987 form", () => {
    // Both are needed: the plain form is what older browsers read, the starred
    // form is what everything current reads. Sending only the plain one mangles
    // a non-Latin student name into replacement characters on download.
    const out = contentDisposition("attendance.csv");
    expect(out).toContain("filename*=UTF-8''attendance.csv");
  });

  it("percent-encodes a non-ASCII name in the starred form", () => {
    const out = contentDisposition("उपस्थिति.csv");
    expect(out).toContain("filename*=UTF-8''");
    expect(out).not.toContain("filename*=UTF-8''उपस्थिति.csv");
  });
});
