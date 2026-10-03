import "server-only";

/**
 * Count, clamp, then fetch - in that order, for every paged list.
 *
 * The order is the whole point, and it costs a round trip.
 *
 * The obvious implementation parses `?page=`, queries `skip`/`take` from it, and
 * clamps the page afterwards for display. That is wrong in a way that only shows
 * up once a list has more than one page: `?page=5` on a two-page list queries
 * with `skip=100`, gets nothing back, and then the pager - correctly noticing the
 * clamp - renders "Showing 26 to 40 of 40" above an empty table. The label and
 * the rows are each individually correct and jointly a lie.
 *
 * So the count has to come first, the clamp has to happen before the row query is
 * built, and the query has to be issued with the clamped number. There is no way
 * to know the last page without counting it, which is why this is sequential and
 * not a `Promise.all`.
 *
 * A second thing this centralises: the count and the rows must be filtered by the
 * *same* predicate. Two `where` clauses that drift apart produce a pager whose
 * counts disagree with its contents, and that is invisible in review because both
 * halves look right. Taking the filter from a closure the caller already uses for
 * the row query removes the possibility rather than documenting it.
 */

import {
  buildPage,
  pageCount,
  parsePage,
  sanitizePerPage,
  type Page,
  type RawPage,
} from "@/lib/pagination";

export type Paged<T> = {
  /** The rows on this page. */
  rows: T[];
  /** Everything the pager needs, already clamped. */
  page: Page;
};

export async function paged<T>({
  raw,
  perPage,
  count,
  rows,
}: {
  /** `searchParams.page` straight from the URL. */
  raw: RawPage;
  perPage?: number;
  /** Total matching the same predicate as `rows`. */
  count: () => Promise<number>;
  /** The windowed query. Called once, with a clamped skip. */
  rows: (window: { skip: number; take: number }) => Promise<T[]>;
}): Promise<Paged<T>> {
  const size = sanitizePerPage(perPage);
  const total = await count();

  // Clamp here, where the total is known and before the query is built.
  const page = Math.min(parsePage(raw), pageCount(total, size));

  const found = await rows({ skip: (page - 1) * size, take: size });

  return {
    rows: found,
    // `shown` is the real row count, so the "showing X to Y" line is derived from
    // data rather than from the window that was requested.
    page: buildPage(page, size, total, found.length),
  };
}

/**
 * A stable tiebreaker to append to every paged `orderBy`.
 *
 * Pagination over a *partially* ordered list is not just imprecise, it is wrong.
 * Rows that tie on the sort key come back in an order Postgres is free to change
 * between the two requests that fetch page 1 and page 2 - so a row can appear on
 * both, or on neither, and the list neither loses nor duplicates anything. It is
 * invisible with twenty-five rows and appears the moment there are more.
 *
 * Appending the primary key makes the order total without changing what the list
 * means: rows that genuinely tie are in a stable, arbitrary-but-fixed order.
 *
 * Note this is about `orderBy` and not about `take` - a bare `take` without a
 * matching total order is the same defect.
 */
export function withIdOrder<T extends readonly string[]>(
  by: T,
  direction: "asc" | "desc" = "asc",
): [...T, { id: "asc" | "desc" }] {
  return [...by, { id: direction }];
}