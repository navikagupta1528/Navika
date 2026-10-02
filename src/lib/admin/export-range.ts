/**
 * Date-window handling for the exports. Pure, no server-only import, no database.
 *
 * Split out of `@/lib/admin/exports` for the same reason `tracking.ts` and
 * `health.ts` are their own files: this is the part that can be wrong quietly.
 * A range validator that accepts `from=abc` is not an error the user sees, it is
 * a whole-file export of every student in the college - and the test for that
 * needs no database at all.
 */

/**
 * The widest window one export request may cover.
 *
 * Not arbitrary. A year of attendance is one row per student per trip per
 * direction; at a realistic college that is six figures, and the browser making
 * the request has to hold it as a string. Refusing is better than timing out in
 * front of an admin who has just asked for the whole year and will try again.
 */
export const MAX_EXPORT_DAYS = 400;

/** Exactly `YYYY-MM-DD`. Deliberately stricter than `Date.parse`, which is not. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Range = { ok: true; from: string; to: string } | { ok: false; error: string };

/**
 * Validate an inclusive `from`/`to` pair.
 *
 * Order matters more than it looks. `Date.parse("2026-02-31")` returns a real
 * timestamp in March, so a date that does not exist passes a naive parse and
 * silently shifts the window. Round-tripping the parts is what catches it.
 */
export function validateRange(from: string | null, to: string | null): Range {
  if (!from || !to) {
    return { ok: false, error: "Give both dates as YYYY-MM-DD." };
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return { ok: false, error: "Give both dates as YYYY-MM-DD." };
  }
  if (!isRealDate(from) || !isRealDate(to)) {
    return { ok: false, error: "One of those dates does not exist." };
  }

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  if (fromMs > toMs) {
    return { ok: false, error: "The start date is after the end date." };
  }

  const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (days > MAX_EXPORT_DAYS) {
    return {
      ok: false,
      error: `That is ${days} days. Narrow the range to ${MAX_EXPORT_DAYS} days or fewer.`,
    };
  }

  return { ok: true, from, to };
}

/**
 * True when the string names a date that actually exists.
 *
 * `new Date("2026-02-31")` is 3 March, so comparing the constructed date's parts
 * against the input is what distinguishes the 31st from the 3rd.
 */
function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const built = new Date(Date.UTC(y, m - 1, d));
  return (
    built.getUTCFullYear() === y && built.getUTCMonth() === m - 1 && built.getUTCDate() === d
  );
}

/**
 * Local-midnight bounds for an inclusive `YYYY-MM-DD` range.
 *
 * The upper bound is the *start* of the day after `to`, and exclusive, because
 * using `new Date(to)` would mean an end date of `2026-03-01` silently covered
 * only the single midnight at the start of that day - so an admin asking for
 * "everything through the 1st" would get the 1st back as empty and assume the
 * bus did not run.
 *
 * Local, not UTC, because `Trip.date` is stored as a local calendar date. Using
 * UTC here would put a trip at 05:30 the next morning for any college east of
 * Greenwich, and drop it out of its own day's export.
 */
export function dateWindow(from: string, to: string): { gte: Date; lt: Date } {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];

  return {
    gte: new Date(fy, fm - 1, fd),
    lt: new Date(ty, tm - 1, td + 1),
  };
}