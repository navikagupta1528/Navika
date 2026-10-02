/**
 * "Today" as a range, in one place.
 *
 * Split out of `queries.ts` rather than living there so it can be unit tested:
 * `queries.ts` imports `server-only`, which throws as soon as anything outside a
 * React server component touches it. A function this small, with this many
 * edge cases around midnight and DST, is exactly the kind of thing that should
 * be covered by tests that need no database and no React.
 */

/**
 * Today, as a half-open range of local time: `[start, end)`.
 *
 * `Trip.date` is a `@db.Date` column, so it is compared against a timestamp with
 * the time zeroed and the end exclusive. The exclusive end matters: an
 * inclusive `<= tomorrow` would pull in every trip dated exactly tomorrow,
 * because the column has no time component to separate them.
 *
 * The clock is read in a default parameter, so it is read when this function is
 * called and not when the module loads. A component that called `Date.now()`
 * directly would break the render purity rule, and a module-level constant
 * would be stamped once when the server booted - so a process left running
 * overnight would go on answering with yesterday. This is the same arrangement
 * `getFleetPositions` uses for its `asOf`.
 *
 * Callers get `now` back too, so a page that also needs "how long has this been
 * silent" compares against the same instant this range was built from rather
 * than taking a second reading that could disagree.
 */
export function dayWindow(nowMs: number = Date.now()): {
  now: number;
  start: Date;
  end: Date;
} {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { now: nowMs, start, end };
}