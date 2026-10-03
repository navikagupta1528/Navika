import { describe, expect, it } from "vitest";

import {
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  buildPage,
  describeWindow,
  hasNext,
  hasPrevious,
  pageCount,
  pageWindow,
  parsePage,
  sanitizePerPage,
} from "./pagination";

/** 25 rows on page 1 of a 40-row list. */
const window = (raw: unknown, total: number, shown: number, perPage = 25) =>
  buildPage(raw as string, perPage, total, shown);

describe("parsePage", () => {
  it("reads a normal page number", () => {
    expect(parsePage("3")).toBe(3);
  });

  it("defaults to the first page when there is nothing to read", () => {
    for (const raw of [undefined, null, "", "   "]) {
      expect(parsePage(raw)).toBe(1);
    }
  });

  it("rejects a number with trailing junk rather than accepting the prefix", () => {
    /*
     * `Number("3abc")` is 3 and `Number("1e9")` is a billion. A page parameter is a
     * whole number a human typed; accepting the numeric prefix of `3abc` would let
     * a mistyped URL land somewhere real and confusing instead of somewhere safe.
     */
    expect(parsePage("3abc")).toBe(1);
    expect(parsePage("1e9")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("0x10")).toBe(1);
  });

  it("treats zero and negative as the first page, not an error", () => {
    // Neither is a state a person is in; both are typos, and the polite reading
    // of a typo is the first page.
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-7")).toBe(1);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parsePage(" 4 ")).toBe(4);
  });

  it("uses the first value when the parameter is repeated", () => {
    // `?page=2&page=9` arrives as an array. Taking the last would let a link
    // silently override the page it names.
    expect(parsePage(["2", "9"])).toBe(2);
  });

  it("refuses a page number large enough to hurt the database", () => {
    expect(parsePage("999999999")).toBe(1);
  });
});

describe("sanitizePerPage", () => {
  it("keeps a usable size", () => {
    expect(sanitizePerPage(50)).toBe(50);
    expect(sanitizePerPage("50")).toBe(50);
  });

  it("falls back for anything that is not a positive number", () => {
    for (const raw of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, "abc", null]) {
      expect(sanitizePerPage(raw)).toBe(DEFAULT_PER_PAGE);
    }
  });

  it("caps at the maximum, so a URL cannot ask for the whole table", () => {
    expect(sanitizePerPage(1_000_000)).toBe(MAX_PER_PAGE);
  });
});

describe("pageCount", () => {
  it("counts the pages a total fills", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(1, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(100, 25)).toBe(4);
  });

  it("always reports at least one page for an empty list", () => {
    // Otherwise the pager renders nothing at all, which reads as a missing
    // control rather than an empty result.
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(-5, 25)).toBe(1);
  });
});

describe("buildPage", () => {
  it("produces the window for a middle page", () => {
    const p = window("2", 40, 15);
    expect(p).toMatchObject({
      page: 2,
      perPage: 25,
      skip: 25,
      take: 25,
      total: 40,
      pageCount: 2,
      from: 26,
      to: 40,
    });
  });

  it("clamps a page beyond the end instead of returning an empty table", () => {
    /*
     * The whole reason `parsePage` and `buildPage` are separate. `?page=5` on a
     * list that has since shrunk to one page has to show that page - and the last
     * page is not known until the count has run, so this cannot happen while
     * parsing.
     */
    const p = window("5", 40, 15);
    expect(p.page).toBe(2);
    expect(p.pageCount).toBe(2);
    expect(p.skip).toBe(25);
  });

  it("clamps to page 1 when there is nothing to page through", () => {
    const p = window("4", 0, 0);
    expect(p.page).toBe(1);
    expect(p.pageCount).toBe(1);
    expect(p.from).toBe(0);
    expect(p.to).toBe(0);
  });

  it("derives from and to from the rows that came back, not the window asked for", () => {
    /*
     * `shown` is not always `take`. The last page is short, and a row can vanish
     * between the count and the fetch. Reading "Showing 26 to 50 of 40" because
     * that is what the window said is the kind of wrong that erodes trust in
     * every other number on the page.
     */
    expect(window("2", 40, 3).to).toBe(28);
    expect(window("2", 40, 0).to).toBe(0);
    expect(window("1", 0, 0).to).toBe(0);
  });

  it("never reports a range for a page that came back empty", () => {
    const p = window("1", 100, 0);
    expect(p.from).toBe(0);
    expect(p.to).toBe(0);
  });

  it("survives a nonsense total", () => {
    for (const total of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const p = buildPage("1", 25, total, 0);
      expect(p.total).toBe(0);
      expect(p.pageCount).toBe(1);
      expect(p.page).toBe(1);
    }
  });
});

describe("describeWindow", () => {
  it("says nothing is there rather than printing an empty range", () => {
    /*
     * The obvious template prints "Showing 1 to 25 of 0" on an empty list, and an
     * empty list is the first thing a person meets after a filter narrows to
     * nothing. It reads as broken.
     */
    expect(describeWindow(window("1", 0, 0))).toBe("No results");
  });

  it("does not show a from-1-to-25 range for a single short page", () => {
    expect(describeWindow(window("1", 7, 7))).toBe("Showing 7 of 7");
  });

  it("gives the range across several pages", () => {
    expect(describeWindow(window("1", 40, 25))).toBe("Showing 1 to 25 of 40");
    expect(describeWindow(window("2", 40, 15))).toBe("Showing 26 to 40 of 40");
  });
});

describe("pageWindow", () => {
  it("shows a single page when there is only one", () => {
    expect(pageWindow(window("1", 7, 7))).toEqual([1]);
  });

  it("shows every page when they all fit", () => {
    expect(pageWindow(window("2", 75, 25))).toEqual([1, 2, 3]);
  });

  it("elides the middle but keeps the first, last and current", () => {
    /*
     * Eighty numbered buttons is longer than the list it navigates and needs a
     * scrollbar of its own.
     */
    expect(pageWindow(window("2", 2000, 25))).toEqual([1, 2, 3, null, 80]);
    expect(pageWindow(window("40", 2000, 25))).toEqual([1, null, 39, 40, 41, null, 80]);
    // `around` is 1, so the last page shows itself and the one before it - not
    // three. The window is asymmetric with the elision, which is what keeps the
    // control a fixed width no matter where you are in the list.
    expect(pageWindow(window("80", 2000, 25))).toEqual([1, null, 79, 80]);
  });

  it("names a single missing page instead of an ellipsis", () => {
    // "…" for one page is longer than the number and hides something useful.
    const pages = pageWindow(buildPage("3", 25, 500, 25));
    expect(pages).toEqual([1, 2, 3, 4, null, 20]);
  });
});

describe("hasPrevious and hasNext", () => {
  it("has neither control on a single page", () => {
    const p = window("1", 7, 7);
    expect(hasPrevious(p)).toBe(false);
    expect(hasNext(p)).toBe(false);
  });

  it("has only next on the first of several pages", () => {
    const p = window("1", 40, 25);
    expect(hasPrevious(p)).toBe(false);
    expect(hasNext(p)).toBe(true);
  });

  it("has only previous on the last page", () => {
    const p = window("2", 40, 15);
    expect(hasPrevious(p)).toBe(true);
    expect(hasNext(p)).toBe(false);
  });
});