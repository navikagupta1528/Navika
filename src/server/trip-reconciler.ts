/**
 * Closing trips that were started and then abandoned.
 *
 * `startTrip` sets ONGOING and `completeTrip` clears it. Between those two
 * writes the trip is owned by nobody: if the driver's phone dies, the tab is
 * discarded, the process restarts mid-run, or an admin starts a trip to look at
 * the screen and walks away, the row stays ONGOING forever.
 *
 * The cost of a stuck row is not cosmetic. It keeps the bus looking live on the
 * fleet map, it blocks the same driver from starting the next run because of
 * the `@@unique([busId, date, direction])` constraint, and it inflates every
 * attendance report with a run that never finished.
 *
 * The decision of *which* trips are stuck lives in `src/lib/trip-liveness.ts`,
 * which is pure and unit tested. This file owns the interval, the reads and the
 * writes, none of which can be tested without a database.
 *
 * WHY COMPLETED AND NOT CANCELLED.
 *
 * CANCELLED would be a lie about what happened. The pickup records on an
 * abandoned trip are not noise - students really were put on that bus, and
 * `PICKED` rows were really ticked off by a driver who really drove the route.
 * Completing it settles the unresolved rows exactly the way the admin's own
 * "Complete trip" button does (`completeTrip` in `src/app/actions/admin/trips.ts`
 * is the reference implementation), so an abandoned run lands in the reports
 * with the same arithmetic as a manually finished one, and the two paths cannot
 * drift apart.
 */

import { prisma } from "@/lib/db";
import { PickupStatus, TripStatus } from "@/generated/prisma/enums";
import { abandonedCutoff, isTripAbandoned, lastActivityAt } from "@/lib/trip-liveness";

/**
 * How often to look for stuck trips.
 *
 * Ten minutes. The threshold is three hours, so this cadence decides how long a
 * dead row is visible before it is closed, and ten minutes against three hours
 * is a rounding error. Sweeping more often would buy nothing: a trip that is
 * about to cross the threshold is a trip the driver may still be driving, and
 * the check that matters has already run.
 */
export const RECONCILE_EVERY_MS = 10 * 60 * 1000;

/** How many candidate rows one sweep will read, so a bad data set cannot stall boot. */
const MAX_CANDIDATES = 500;

export type ReconcileResult = {
  /** Trips closed by this sweep. */
  closed: string[];
  /** Candidate rows examined but judged still alive. Reported for the log. */
  spared: number;
  /** Set when the sweep itself failed, so the caller can log instead of crash. */
  error?: string;
};

/**
 * Close every ONGOING trip that has gone silent, and report what happened.
 *
 * Never throws. This runs on an interval and during boot, where an unhandled
 * rejection would take the process down; a database that is not reachable is a
 * normal condition, not a reason to refuse to serve traffic. The next sweep,
 * or the next page load, picks up whatever was missed.
 *
 * `now` is a parameter so a caller can sweep against a single consistent
 * instant across every row rather than re-reading the clock per trip.
 */
export async function reconcileAbandonedTrips(now: number = Date.now()): Promise<ReconcileResult> {
  const cutoff = abandonedCutoff(now);

  try {
    /*
     * Prisma cannot express "the newest of these four columns, one of which
     * belongs to another table", so the candidate set is narrowed with the
     * strongest single guard - the bus ping - and the pure rule makes the real
     * decision in application code.
     *
     * The filter has to be an OR across all three own-row signals, not just the
     * ping. A bus whose last ping predates the cutoff because it has since been
     * reassigned to a different bus would otherwise hide a genuinely dead trip
     * behind a live bus's ping.
     */
    const candidates = await prisma.trip.findMany({
      where: {
        status: TripStatus.ONGOING,
        OR: [
          { startedAt: { lt: cutoff } },
          { updatedAt: { lt: cutoff } },
          { bus: { lastLocationAt: { lt: cutoff } } },
          { bus: { lastLocationAt: null } },
        ],
      },
      orderBy: { startedAt: "asc" },
      take: MAX_CANDIDATES,
      select: {
        id: true,
        status: true,
        busId: true,
        startedAt: true,
        createdAt: true,
        updatedAt: true,
        endedAt: true,
        bus: { select: { lastLocationAt: true } },
      },
    });

    const abandoned = candidates.filter((t) => isTripAbandoned(t, now));

    const closed: string[] = [];
    for (const trip of abandoned) {
      // endedAt is the last moment the trip showed life, not the sweep time.
      // Backdating it keeps the trip's duration honest - a run that died at
      // 14:20 ends at 14:20 whether or not anyone noticed until 17:00 - and
      // stops a dead row from looking like a run that was active all afternoon.
      const endedAt = new Date(lastActivityAt(trip) ?? trip.startedAt ?? now);

      // Re-check the status inside the update. Two sweeps racing, or a sweep
      // overlapping the admin pressing "Complete trip", would otherwise let one
      // of them overwrite the other's settlement.
      const result = await prisma.trip.updateMany({
        where: { id: trip.id, status: TripStatus.ONGOING },
        data: { status: TripStatus.COMPLETED, endedAt },
      });
      if (result.count === 0) continue;

      /*
       * Settle the records and the onboard count in the same transaction the
       * trip is closed in. A completed trip whose PENDING rows were never
       * resolved would show as "not picked up: 0" rather than the truth, and
       * the bus would keep counting students who are not on it.
       */
      await prisma.$transaction(async (tx) => {
        await tx.pickupRecord.updateMany({
          where: { tripId: trip.id, status: { in: [PickupStatus.PENDING, PickupStatus.WAITING] } },
          data: { status: PickupStatus.MISSED },
        });

        const picked = await tx.pickupRecord.count({
          where: { tripId: trip.id, status: PickupStatus.PICKED },
        });

        await tx.bus.update({ where: { id: trip.busId }, data: { onboardCount: picked } });
      });

      closed.push(trip.id);
    }

    return { closed, spared: candidates.length - abandoned.length };
  } catch (error) {
    return {
      closed: [],
      spared: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Sweep once at boot, then on an interval.
 *
 * The boot sweep is the important one: it is what repairs rows left behind by
 * the previous process, which is the single most common way a deployment leaves
 * a stuck trip behind. The interval covers the ordinary case, a phone dying
 * mid-afternoon, while the app is up.
 *
 * The timer is unref'd so a sweep in flight can never be the reason a graceful
 * shutdown waits on it, and it is not started twice if `main()` runs again in
 * the same process.
 */
export async function startTripReconciler(): Promise<void> {
  const first = await reconcileAbandonedTrips();
  logSweep(first, "boot");

  if (timer) return;
  timer = setInterval(() => {
    void reconcileAbandonedTrips().then((result) => logSweep(result, "sweep"));
  }, RECONCILE_EVERY_MS);
  timer.unref();
}

/** Stop the interval. Only used by tests and by the shutdown path. */
export function stopTripReconciler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function logSweep(result: ReconcileResult, when: "boot" | "sweep"): void {
  if (result.error) {
    console.warn(`  trips: reconciliation skipped on ${when} sweep - ${result.error}`);
    return;
  }
  if (result.closed.length > 0) {
    console.log(`  trips: closed ${result.closed.length} abandoned trip(s) on ${when} sweep`);
  }
  if (result.spared > 0) {
    console.log(`  trips: ${result.spared} candidate trip(s) still live, left alone`);
  }
}