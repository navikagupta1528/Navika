/**
 * When is an ONGOING trip actually over?
 *
 * A trip is set to ONGOING by `startTrip` and cleared by `completeTrip`, and in
 * between those two writes nothing owns it. In the field that window is closed
 * by events nobody put on a calendar:
 *
 *   - the driver's phone dies in a dead zone and never reconnects,
 *   - the app is killed by the OS, or the browser tab is discarded,
 *   - the process that was writing the stop arrivals is restarted mid-run,
 *   - an admin books a run, starts it to test the screen, and walks away.
 *
 * Every one of those leaves the row ONGOING forever. That is not a cosmetic
 * problem. A stuck trip means the bus looks live on the fleet map, the driver
 * cannot start the next run on it, the student dashboards show a run that
 * ended days ago as still arriving, and the attendance report counts an
 * unfinished trip as if it had happened.
 *
 * So "ONGOING" cannot be trusted on its own. What makes a trip genuinely
 * alive is recent activity, not the status column. This module answers that
 * question and nothing else: no database, no clock, no network. `now` is
 * always a parameter so the rule is testable at an exact instant, which is why
 * `Date.now()` appears nowhere in here or in its callers' render paths.
 */

/**
 * How long a run may go without any sign of life before it is presumed dead.
 *
 * Three hours is chosen against the shape of the data, not by taste. A college
 * bus route is 40-90 minutes end to end; the longest seeded run plus its
 * return leg sits under two. Three hours therefore clears every legitimate
 * gap - a driver stuck in traffic at the end of a long route, a school that
 * runs a late extra trip - while still closing the stuck row on the same day
 * rather than leaving it for a nightly batch. A trip that is genuinely still
 * running pings the bus location every few seconds, so the margin over a real
 * run is enormous.
 */
export const ABANDONED_TRIP_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * The subset of a Trip (and its Bus) needed to decide liveness.
 *
 * Every field is nullable because Prisma's types say so, not because the
 * database is loose: `startedAt` is null for a trip that was never started,
 * and `bus.lastLocationAt` is null for a bus that has never reported. The
 * callers project exactly these columns so this stays a plain structural type
 * rather than a generated-model import, which keeps it unit-testable without a
 * database and free of the Prisma client at runtime.
 */
export type LivenessTrip = {
  status: string;
  startedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  bus: { lastLocationAt: Date | null } | null;
};

function ms(value: Date | null | undefined): number | null {
  if (!value) return null;
  const t = value.getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The most recent moment this trip showed any sign of being alive, or null if
 * there is genuinely nothing to go on.
 *
 * Four signals, and the order matters:
 *
 *   1. `startedAt` - a run that started an hour ago is alive by definition,
 *      and this is the floor for everything else.
 *   2. `updatedAt` - Prisma bumps it on every write to the row, so a status
 *      change or a recorded delay counts as life.
 *   3. `createdAt` - the fallback for a trip stuck in ONGOING without a
 *      `startedAt`. It should be unreachable, but an unanswerable question
 *      here would mean never reconciling the row at all, which is worse than
 *      guessing from creation time.
 *   4. `bus.lastLocationAt` - the strongest signal, and the only one that
 *      arrives on its own during a healthy run.
 *
 * That last one is clamped to the trip's own lifetime on purpose. The bus
 * column is not per-trip: a bus that finished run 1 and set out on run 2 keeps
 * pinging, and an unclamped reading would hold run 1 "alive" for as long as
 * run 2 lasted. A ping older than `startedAt` therefore says nothing about
 * this trip and is discarded rather than trusted.
 *
 * Returns the maximum of the surviving signals, so an earlier signal can never
 * mask a later one.
 */
export function lastActivityAt(trip: LivenessTrip): number | null {
  const started = ms(trip.startedAt);
  const candidates: number[] = [];

  if (started !== null) candidates.push(started);

  for (const value of [ms(trip.createdAt), ms(trip.updatedAt)]) {
    if (value !== null) candidates.push(value);
  }

  const ping = ms(trip.bus?.lastLocationAt);
  if (ping !== null && (started === null || ping >= started)) {
    candidates.push(ping);
  }

  return candidates.length ? Math.max(...candidates) : null;
}

/**
 * True when this trip is marked ONGOING but has been silent for longer than
 * `ABANDONED_TRIP_AFTER_MS`.
 *
 * Only ONGOING is ever abandoned. A SCHEDULED trip is legitimately silent for
 * days, and a COMPLETED or CANCELLED one is finished by definition - running
 * this over a stale completed trip would be harmless but would keep the
 * reconciliation query scanning rows that can never change.
 *
 * A trip with no recoverable timestamp returns false. "We cannot tell" must
 * not become "close it": an undated ONGOING row is left alone for a human,
 * because quietly completing it could contradict a run that really is
 * happening.
 */
export function isTripAbandoned(trip: LivenessTrip, now: number): boolean {
  if (trip.status !== "ONGOING") return false;
  const last = lastActivityAt(trip);
  if (last === null) return false;
  return now - last > ABANDONED_TRIP_AFTER_MS;
}

/**
 * The newest `updatedAt` an ONGOING trip can have and still be considered
 * live, as a database-comparable value.
 *
 * This exists so reconciliation is a single indexed `UPDATE ... WHERE`
 * rather than a `SELECT` of every ONGOING trip in the table. Prisma cannot
 * express "the max of four columns, one of which is on another table", so the
 * candidate set is narrowed by the strongest single column - the bus ping -
 * and the pure rule above then decides the rest in the application. The
 * cutoff is deliberately generous (it is the union bound of every signal, not
 * any one of them) so the query can only ever be over-inclusive.
 */
export function abandonedCutoff(now: number): Date {
  return new Date(now - ABANDONED_TRIP_AFTER_MS);
}