/**
 * Attendance summarising for one student. Pure, no database, no server-only
 * import, so it can be unit tested.
 *
 * This exists because the questions a parent or an admin actually asks about a
 * single child are arithmetic, and doing that arithmetic inline in a page means
 * it cannot be checked. "Was Aarav picked up this week" is not a question a
 * database can answer directly; it is a question about the last N rows.
 *
 * The unit of a streak is *trips*, not days, and that distinction is the whole
 * point. A school week has a Sunday in it, and a day-based streak would report
 * a child as having an unbroken miss streak across a weekend when the bus was
 * not running - which would both be wrong and alarming to a parent reading it.
 */

/** Mirrors the `PickupStatus` enum. Repeated here so this module stays pure. */
export type AttendanceStatus = "PENDING" | "WAITING" | "PICKED" | "MISSED" | "ABSENT";

export type AttendanceRow = {
  date: string;
  direction: string;
  status: AttendanceStatus;
  /** Optional. Only counted when present, so a caller that omits it still works. */
  stop?: string;
};

export type AttendanceSummary = {
  /** Rows in the window, any status. */
  total: number;
  picked: number;
  missed: number;
  waiting: number;
  pending: number;
  absent: number;

  /**
   * Picked / (picked + missed), as a whole percentage, or null when nothing was
   * settled. Null rather than 0 because "0%" for a child with no trips reads as
   * a failing grade, and the honest answer is "no data".
   */
  pickRate: number | null;

  /** Trips since the most recent pickup that was not a pickup. 0 if last was picked. */
  sinceLastPickup: number;

  /** The longest such run anywhere in the window. */
  longestGap: number;

  /** Busiest day by trip count, for the one-line summary. */
  mostTripsOn: { date: string; count: number } | null;

  /** The busiest stop. Null when the child has no history. */
  stopsUsed: number;
};

/**
 * Summarise a student's attendance.
 *
 * `rows` may arrive in any order. The gap calculations walk backwards through
 * most-recent-first, so sorting here rather than trusting the caller is what
 * stops a differently-ordered query from reporting a child as having never been
 * picked up.
 */
export function summariseAttendance(rows: readonly AttendanceRow[]): AttendanceSummary {
  // Keyed by the enum's own uppercase values, then mapped to the lowercase field
  // names the summary exposes. Indexing a lowercase-keyed object with an
  // uppercase status silently yields `undefined++`, i.e. NaN, which then turns
  // the pick rate into `null` - a screen showing "no data" for a child with a
  // full history and no visible error anywhere. The two vocabularies are kept
  // visibly separate so that mistake is hard to write.
  const tally: Record<AttendanceStatus, number> = {
    PICKED: 0,
    MISSED: 0,
    WAITING: 0,
    PENDING: 0,
    ABSENT: 0,
  };

  const perDay = new Map<string, number>();
  const perStop = new Set<string>();

  for (const row of rows) {
    tally[row.status] += 1;
    perDay.set(row.date, (perDay.get(row.date) ?? 0) + 1);
    if (row.stop) perStop.add(row.stop);
  }

  const settled = tally.PICKED + tally.MISSED;

  return {
    total: rows.length,
    picked: tally.PICKED,
    missed: tally.MISSED,
    waiting: tally.WAITING,
    pending: tally.PENDING,
    absent: tally.ABSENT,
    pickRate: settled > 0 ? Math.round((tally.PICKED / settled) * 100) : null,
    ...gaps(rows),
    mostTripsOn: busiest(perDay),
    stopsUsed: perStop.size,
  };
}

/**
 * Longest run of consecutive non-pickup trips, and the run at the end.
 *
 * Counts `WAITING` as a gap on purpose. "Marked waiting, bus left" is a
 * different failure from "never showed", but from the parent's side both mean the
 * child did not get on, and the number that matters to them is how many times in
 * a row that has now happened.
 */
function gaps(rows: readonly AttendanceRow[]): {
  sinceLastPickup: number;
  longestGap: number;
} {
  const ordered = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  let longest = 0;
  let run = 0;
  let trailing = 0;
  let seenPickup = false;

  for (const row of ordered) {
    if (row.status === "PICKED") {
      longest = Math.max(longest, run);
      run = 0;
      seenPickup = true;
      /*
       * `trailing` is deliberately NOT reset here. The walk is most-recent-first,
       * so the run since the last pickup is accumulated at the *start* of the
       * list; clearing it on the first pickup erases exactly the number being
       * computed and reports a child who missed the last two trips as having
       * missed none. Freezing it once `seenPickup` flips is the whole fix.
       */
      continue;
    }
    run += 1;
    if (!seenPickup) trailing += 1;
  }

  return { sinceLastPickup: trailing, longestGap: Math.max(longest, run) };
}

function busiest(perDay: Map<string, number>): { date: string; count: number } | null {
  let best: { date: string; count: number } | null = null;
  for (const [date, count] of perDay) {
    if (!best || count > best.count) best = { date, count };
  }
  return best;
}