import Link from "next/link";

import {
  describeWindow,
  hasNext,
  hasPrevious,
  pageWindow,
  type Page,
} from "@/lib/pagination";

/**
 * Paging controls for a server-rendered list.
 *
 * A server component, like the lists it sits under. Paging is a navigation, so
 * each control is a real link with a real href: it can be opened in a new tab,
 * copied, bookmarked, crawled, and it survives JavaScript not loading. Building
 * the href on the server also means it carries whatever filters are currently
 * applied, which a button that re-fetches would have to be told about separately
 * and would eventually get wrong.
 */
export function Pagination({
  page,
  basePath,
  params = {},
}: {
  /** The window returned by `buildPage`. */
  page: Page;
  /** Path this list lives at, e.g. `/admin/trips`. */
  basePath: string;
  /** Filters to carry across, so paging does not silently drop them. */
  params?: Record<string, string | undefined>;
}) {
  // Nothing to page through, and a lone "Showing 0 of 0" is just noise.
  if (page.pageCount <= 1) {
    return page.total > 0 ? (
      <p className="mt-4 text-sm text-slate-600">{describeWindow(page)}</p>
    ) : null;
  }

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-slate-600">{describeWindow(page)}</p>

      <ul className="flex items-center gap-1">
        <Step basePath={basePath} params={params} target={page.page - 1} disabled={!hasPrevious(page)}>
          Previous
        </Step>

        {pageWindow(page).map((n, i) =>
          n === null ? (
            <li
              key={`gap-${i}`}
              aria-hidden="true"
              className="px-2 text-sm text-slate-500 select-none"
            >
              &hellip;
            </li>
          ) : (
            <li key={n}>
              <Link
                href={href(basePath, params, n)}
                // The current page is not a link to itself. A link that goes
                // nowhere is noise in the tab order, and `aria-current` is what a
                // screen reader announces instead.
                aria-current={n === page.page ? "page" : undefined}
                className={
                  n === page.page
                    ? "flex h-9 min-w-9 items-center justify-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white"
                    : "flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                }
              >
                {n}
              </Link>
            </li>
          ),
        )}

        <Step basePath={basePath} params={params} target={page.page + 1} disabled={!hasNext(page)}>
          Next
        </Step>
      </ul>
    </nav>
  );
}

/**
 * Previous / Next.
 *
 * Rendered as an inert `<li>` when there is nowhere to go rather than a disabled
 * button - see below for why.
 */
function Step({
  basePath,
  params,
  target,
  disabled,
  children,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  target: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className =
    "flex h-9 items-center rounded-lg px-3 text-sm font-medium";

  if (disabled) {
    return (
      // Not a link and not a button: an inert `<li>`. A disabled button is skipped
      // by keyboard and says nothing, whereas this is still read in place, so
      // "Previous" appears in the list and is visibly grey - which is how you
      // convey "you are on page 1" without pretending there is something to press.
      // `aria-disabled` is not set because it is not supported on `listitem`; the
      // absence of a link is the accessible part.
      <li className={`${className} text-slate-500`}>{children}</li>
    );
  }

  return (
    <li>
      <Link href={href(basePath, params, target)} className={`${className} hover:bg-slate-100`}>
        {children}
      </Link>
    </li>
  );
}

/**
 * The href for a page, carrying the current filters.
 *
 * `page=1` is left out rather than written explicitly. It makes the first page
 * the canonical URL for the unfiltered list, so a list and its page one are the
 * same address instead of two that show the same thing - which matters for
 * anything that counts links, and for a bookmark either way round.
 *
 * Undefined values are dropped rather than serialised, because
 * `?q=undefined` looks like a search for the literal word and would come back
 * with nothing.
 */
function href(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}