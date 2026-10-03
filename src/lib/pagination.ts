/**
 * Pagination arithmetic.
 *
 * Pure: no database, no network, no DOM, no ambient clock. Everything that
 * decides *which* rows to fetch is here, so it can be tested exhaustively, and
 * everything that fetches them is a two-line caller.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three lists took a fixed number of rows and said nothing about the total:
 * students 25, trips 100, alerts 100. Past those numbers the extra rows did not
 * fail to load - they were never asked for, and nothing on screen said so. An
 * admin looking at a week of trips across a real fleet would see a complete,
 * confident, quietly wrong list. For the alerts list that is worse than wrong: the
 * rows that vanish are emergency alerts, so the truncation silently removes the
 * entries that matter most.
 *
 * A hard cap without a count is not a limit, it is a lie about the size of the
 * data.
 *
 * THE PART THAT BITES
 * -------------------
 * Clamping. `?page=5` on a list that has since shrunk to two pages has to show
 * page 2, not an empty table - and the page count is not known until the count
 * query has run, so clamping cannot happen while parsing. `buildPage` therefore
 * takes the total and does both jobs, which is why the parse and the clamp are
 * separate steps rather than one `parsePage`.
 *
 * The other half is ordering, and it is not in this file because it is not
 * arithmetic - it is a property of the query. Any list that is paged must have a
 * *total* order, or a row can appear on two pages or on none. Sorting by
 * `{date, scheduledStart}` is not total: rows sharing both are returned in an
 * arbitrary order that Postgres is free to change between requests, so a trip can
 * show up on page 1 and page 2. The fix is to append the primary key to every
 * paged `orderBy`, which makes the order total without changing what the list
 * means. See `listTrips` in `src/lib/admin/queries.ts`.
 */

/** Rows per page unless a caller says otherwise. */
export const DEFAULT_PER_PAGE = 25;

/**
 * Ceiling on `perPage`, whatever a caller or a URL asks for.
 *
 * Not a security control on its own - a URL cannot choose this - but the value is
 * also read from a query string in a couple of places, and "fetch the entire
 * table" is never a legitimate page size for a list a human is scrolling.
 */
export const MAX_PER_PAGE = 200;

/**
 * A raw `?page=` value: a string, possibly absent, possibly repeated.
 *
 * Next gives `searchParams` values as `string | string[] | undefined`, and a
 * repeated parameter arrives as an array. A `number` is accepted too, for the
 * case where a page has already been parsed once and is being re-normalised.
 */
export type RawPage = string | number | string[] | undefined | null;

/**
 * A page number that is safe to compute a window from.
 *
 * Everything invalid becomes 1. There is no error case, because "page 0" and
 * "page -4" are not states a person is in - they are typos in a URL, and the
 * polite reading of a typo is the first page. Returning `NaN` instead would put
 * the arithmetic at the mercy of whatever the caller does with it.
 *
 * Note this does *not* clamp to the last page, because the last page is not known
 * until the total is counted. See `buildPage`.
 */
export function parsePage(raw: RawPage): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 1 && raw <= 1_000_000
      ? Math.floor(raw)
      : 1;
  }

  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return 1;

  const trimmed = first.trim();
  // Reject "3abc" and "1e9", both of which `Number` would happily accept as 3 and
  // 1000000000. A page parameter is a whole number written by a human.
  if (!/^\d+$/.test(trimmed)) return 1;

  const n = Number(trimmed);
  // Beyond this a skip count stops being arithmetic and starts being a denial of
  // service on the database, and no real list has that many pages.
  return n >= 1 && n <= 1_000_000 ? n : 1;
}

/** A page size that is a positive integer no larger than {@link MAX_PER_PAGE}. */
export function sanitizePerPage(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PER_PAGE;
  return Math.min(Math.floor(n), MAX_PER_PAGE);
}

/** How many pages `total` rows fill. Always at least 1, so an empty list is page 1. */
export function pageCount(total: number, perPage: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  const size = Math.max(1, Math.floor(perPage));
  return Math.ceil(total / size);
}

export type Page = {
  /** 1-based, already clamped into range. */
  page: number;
  perPage: number;
  /** Rows to skip, for the query. */
  skip: number;
  /** Rows to take, for the query. */
  take: number;
  /** Rows matching the filter, not the length of this window. */
  total: number;
  /** Pages the total fills. At least 1. */
  pageCount: number;
  /** 1-based index of the first row shown, or 0 when this page is empty. */
  from: number;
  /** 1-based index of the last row shown, or 0 when this page is empty. */
  to: number;
};

/**
 * The window to query, and everything the UI needs to describe it.
 *
 * `total` is the count matching the *same filter* as the row query. Counting with
 * a narrower filter than the rows are fetched with is the classic way to get a
 * pager that lies, so the caller passes one filter to both.
 *
 * `shown` is what actually came back, which is not always `take` - it is smaller
 * on the last page, and smaller than the window if a row vanished between the
 * count and the fetch. `from` and `to` are derived from it so the "showing X to Y
 * of Z" line is computed from real data rather than from the requested window.
 */
export function buildPage(
  raw: RawPage,
  perPage: number,
  total: number,
  shown: number,
): Page {
  const size = sanitizePerPage(perPage);
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const pages = pageCount(safeTotal, size);

  // Clamp here rather than in parsePage: until the count has run there is no
  // "last page" to clamp against.
  const requested = parsePage(raw);
  const page = Math.min(requested, pages);

  const skip = (page - 1) * size;
  const taken = Number.isFinite(shown) && shown > 0 ? Math.floor(shown) : 0;

  return {
    page,
    perPage: size,
    skip,
    take: size,
    total: safeTotal,
    pageCount: pages,
    // `from` is derived from the real row count, so a page that came back empty
    // reads "0 of 0" rather than claiming rows exist that do not.
    from: taken === 0 ? 0 : skip + 1,
    to: taken === 0 ? 0 : skip + taken,
  };
}

/**
 * "Showing 1 to 25 of 40".
 *
 * Worth having rather than inlining, because the empty case is the one that gets
 * forgotten: the obvious template prints "Showing 1 to 25 of 0" on a list with
 * nothing in it, which is the state a person hits first after a filter narrows
 * to nothing, and it reads as broken.
 */
export function describeWindow(page: Page): string {
  if (page.total === 0) return "No results";
  if (page.pageCount === 1) return `Showing ${page.total} of ${page.total}`;
  return `Showing ${page.from} to ${page.to} of ${page.total}`;
}

/**
 * Page numbers to render, with gaps for elision.
 *
 * Always includes the first and last page and the current one plus a small
 * window either side. Returns `null` in the gap, which the component renders as
 * an ellipsis.
 *
 * A windowed pager matters more than it looks: a two-thousand-student cohort is
 * eighty pages of numbered buttons, which is longer than the list it is meant to
 * navigate and needs a scrollbar of its own.
 */
export function pageWindow(page: Page, around = 1): (number | null)[] {
  const { page: current, pageCount } = page;
  if (pageCount <= 1) return [1];

  const keep = new Set<number>([1, pageCount]);
  for (let n = current - around; n <= current + around; n++) {
    if (n >= 1 && n <= pageCount) keep.add(n);
  }

  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let previous = 0;
  for (const n of sorted) {
    if (previous !== 0 && n - previous > 1) {
      // A gap of exactly one page does not need an ellipsis - naming the single
      // missing page is shorter and more useful than "...".
      out.push(n - previous === 2 ? previous + 1 : null);
    }
    out.push(n);
    previous = n;
  }
  return out;
}

/**
 * Whether a previous / next control should be enabled.
 *
 * Separate from the component so "page 1 has no previous" is a tested rule rather
 * than a comparison someone re-derives per list.
 */
export function hasPrevious(page: Page): boolean {
  return page.page > 1;
}

export function hasNext(page: Page): boolean {
  return page.page < page.pageCount;
}