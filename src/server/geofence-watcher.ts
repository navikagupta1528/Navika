/**
 * The geofence watcher: turns a bus's position into "your bus is almost at your
 * stop" alerts for the families waiting at it.
 *
 * Split from `src/lib/geofence.ts` for the same reason the simulator's maths is
 * split from its runner: the decision about *which* ring a stop has entered is
 * pure and unit tested, and this file owns the reading, the writing and the
 * notifying, none of which can be tested without a database and a running bus.
 *
 * WHAT GUARANTEES "ONCE PER RUN"
 *
 * Not this process. A `StopApproach` row is written per (bus, stop, direction,
 * ring, day) *before* the notifications go out, and the write is the lock: two
 * ticks racing through here, or a deploy restarting the interval, cannot both
 * win the unique constraint. A set held in memory would re-alert a stop the bus
 * already served the moment the server restarted — which is exactly when a demo
 * is being restarted.
 *
 * NEVER THROWS
 *
 * Same contract as `notify()`. A geofence alert is a convenience layered on top
 * of a tracking system that is still working; a failure to send one must not
 * unwind the simulator's tick or a driver's location ping. Failures are logged
 * and swallowed.
 */

import { prisma } from "@/lib/db";
import { NotificationType } from "@/generated/prisma/enums";
import { notifyMany } from "@/lib/notifications";
import {
  APPROACHING_METERS,
  approachKey,
  geofenceDateKey,
  newlyApproaching,
  type GeofenceDecision,
  type GeofenceStop,
} from "@/lib/geofence";
import { haversineMeters, type LatLng } from "@/lib/geo";
import { delayMinutesFromSchedule, formatDelayPhrase } from "@/lib/delay";
import { evaluateDelay } from "./delay-watcher";

/**
 * The direction of travel, as a plain literal.
 *
 * Deliberately not the Prisma `Direction` enum or `TripDirection`: a real
 * driver's path has a `Trip.direction` and a simulated bus has only a leg, and
 * both are the same two words. Typing this as the union lets either enum be
 * passed without a cast, while the write to `StopApproach.direction` still lands
 * on Prisma's `Direction` because the values are identical.
 */
export type GeofenceDirection = "PICKUP" | "DROPOFF";

/**
 * How long a `StopApproach` row is kept.
 *
 * The row exists to stop a *repeat* on the same day. Nothing reads it a week
 * later, and the table gains rows all day, so the boot sweep trims it back.
 */
const KEEP_DAYS = 14;

export type GeofenceInput = {
  busId: string;
  position: LatLng;
  direction: GeofenceDirection;
  /** The trip this run belongs to, when there is one. Null for a simulation. */
  tripId?: string | null;
  /**
   * The bus's stops, when the caller already has them.
   *
   * The simulator holds the whole route in memory and hands it over; the real
   * driver path does not, so this is fetched. Passing them avoids a query per
   * tick on the hottest path in the product.
   */
  stops?: readonly GeofenceStop[];
};

/**
 * Evaluate one position and send whatever alerts it newly qualifies for.
 *
 * Callers: the simulator's tick, and the driver's location handler (throttled
 * to its own persist cadence, so the hottest path pays for this at most once
 * every 15 seconds rather than once per ping).
 */
export async function evaluateGeofence(input: GeofenceInput): Promise<void> {
  try {
    const now = new Date();
    const date = geofenceDateKey(now);

    const stops = input.stops ?? (await loadRouteStops(input.busId));
    if (stops.length === 0) return;

    /*
     * Cheapest possible exit, before a single query.
     *
     * Most ticks on most buses are nowhere near any stop. Rejecting them on a
     * distance the caller already had to compute to get here means the common
     * case costs nothing but arithmetic.
     */
    const nearest = Math.min(
      ...stops.map((s) => haversineMeters(input.position, { lat: s.lat, lng: s.lng })),
    );
    if (nearest > APPROACHING_METERS) return;

    const notified = await loadNotifiedKeys(input.busId, input.direction, date);

    const decisions = newlyApproaching({
      position: input.position,
      stops,
      notified,
      busId: input.busId,
      direction: input.direction,
      date,
    });
    if (decisions.length === 0) return;

    // The bus's label, read once and shared by every message this tick sends.
    const bus = await prisma.bus.findUnique({
      where: { id: input.busId },
      select: { busNumber: true },
    });
    const busLabel = bus?.busNumber ?? "Your bus";

    // Sequential rather than `Promise.all`: the writes are what make each ring
    // once-only, and sending the outer ring before the inner one keeps a
    // notification's order on the phone matching the order the bus arrived.
    for (const decision of decisions) {
      const claimed = await claimRing(input, decision, now, date);
      // Lost the race: another tick (or another process) sent this one already.
      if (!claimed) continue;
      const stop = stops.find((s) => s.id === decision.stopId);
      await fanOut(
        input.busId,
        decision,
        input.direction,
        busLabel,
        stop?.scheduledHHMM ?? null,
        now,
      );

      /*
       * The bus has arrived at this stop. If the stop has a schedule and the
       * bus is late against it, that is worth telling the families waiting here
       * — separately from the arrival alert, which says the bus is *here*.
       */
      if (decision.ring === "ARRIVING") {
        await evaluateDelay({
          busId: input.busId,
          stopId: decision.stopId,
          stopName: decision.stopName,
          direction: input.direction,
          tripId: input.tripId ?? "",
          scheduledHHMM: stop?.scheduledHHMM ?? null,
          arrivedAt: now,
          busLabel,
        });
      }
    }
  } catch (error) {
    console.error("[geofence] evaluation failed:", error);
  }
}

/**
 * Write the dedup row. Returns false when it already existed.
 *
 * This is the once-per-run guarantee, and it is taken *before* the notifications
 * rather than after: a crash between sending and writing would re-send on the
 * next tick, while a crash between writing and sending costs one missed alert.
 * A duplicate alert a parent cannot explain is the worse of the two failures.
 */
async function claimRing(
  input: GeofenceInput,
  decision: GeofenceDecision,
  now: Date,
  date: string,
): Promise<boolean> {
  try {
    await prisma.stopApproach.create({
      data: {
        busId: input.busId,
        stopId: decision.stopId,
        tripId: input.tripId ?? null,
        direction: input.direction,
        ring: decision.ring,
        radiusMeters: decision.ring === "ARRIVING" ? 150 : APPROACHING_METERS,
        // Stored as a date, so the midnight rollover is a different row rather
        // than a new unique constraint.
        notifiedAt: now,
        date: new Date(`${date}T00:00:00`),
      },
    });
    return true;
  } catch (error) {
    // Anything that is not a unique violation is a real failure and is
    // re-thrown so the caller's catch logs it. A unique violation is simply
    // "someone already claimed this ring", which is the normal path on every
    // tick after the first.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * True when a Prisma error is "the row was already there".
 *
 * Shared with the missed-boarding watcher, which claims its own ring in the
 * same table and needs the same distinction between "already claimed" (normal)
 * and "the database rejected us" (a real failure worth logging).
 */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  // Prisma's Postgres connector surfaces P2002 for a failed unique constraint.
  return code === "P2002";
}

/** The bus's stops in route order, for a caller that does not already hold them. */
async function loadRouteStops(busId: string): Promise<GeofenceStop[]> {
  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: {
      route: {
        select: {
          routeStops: {
            orderBy: { stopOrder: "asc" },
            select: {
              scheduledHHMM: true,
              stop: { select: { id: true, name: true, lat: true, lng: true } },
            },
          },
        },
      },
    },
  });

  return (
    bus?.route?.routeStops.map((rs) => ({ ...rs.stop, scheduledHHMM: rs.scheduledHHMM })) ?? []
  );
}

/** Every ring this bus has already alerted on today, for this direction. */
async function loadNotifiedKeys(
  busId: string,
  direction: GeofenceDirection,
  date: string,
): Promise<Set<string>> {
  const rows = await prisma.stopApproach.findMany({
    where: { busId, direction, date: new Date(`${date}T00:00:00`) },
    select: { stopId: true, ring: true },
  });

  return new Set(
    rows.map((row) =>
      approachKey({
        busId,
        stopId: row.stopId,
        direction,
        ring: row.ring as "APPROACHING" | "ARRIVING",
        date,
      }),
    ),
  );
}

/**
 * Tell the families waiting at this stop.
 *
 * Resolved through `Enrollment` rather than by role: "the parents at Aundh" is
 * the set of guardians of the students actually enrolled to board there on this
 * bus, in this direction. Notifying every parent would leak one child's bus
 * position to families whose children are not on it — the same mistake the
 * pickup notification exists to avoid.
 */
async function fanOut(
  busId: string,
  decision: GeofenceDecision,
  direction: GeofenceDirection,
  busLabel: string,
  scheduledHHMM: string | null,
  arrivedAt: Date,
): Promise<void> {
  const enrollments = await prisma.enrollment.findMany({
    where: { busId, stopId: decision.stopId, direction, isActive: true },
    select: {
      student: {
        select: {
          // The student's own user id, so the student gets their own copy
          // rather than only their guardians getting one.
          user: { select: { id: true, name: true } },
          guardians: { select: { parent: { select: { userId: true } } } },
        },
      },
    },
  });

  if (enrollments.length === 0) return;

  const arriving = decision.ring === "ARRIVING";
  const title = arriving ? "Bus at your stop" : "Bus almost at your stop";

  /*
   * When the bus is late against this stop's schedule, the arrival message says
   * so. A parent who is told the bus is here but not that it is twenty minutes
   * late will send their child out into the cold for a bus that is still on the
   * previous road — the delay is the part that changes what they do next.
   */
  const delayNote =
    arriving && scheduledHHMM
      ? ` It is running ${formatDelayPhrase(delayMinutesFromSchedule(scheduledHHMM, arrivedAt))}.`
      : "";

  const inputs = enrollments.flatMap((enrollment) => {
    const first = enrollment.student.user.name.split(" ")[0] || "your child";
    const body = arriving
      ? `${busLabel} is at ${decision.stopName} now. ${first} should head out.${delayNote}`
      : `${busLabel} is about ${etaPhrase(decision.etaSeconds)} from ${decision.stopName}. ${first} can get ready.`;

    // Guardians, plus the student themself. A student who travels alone — no
    // guardian linked — still gets the alert on their own phone, which is the
    // difference between this being useful to a family and useful to a
    // household that happens to have a parent with the app.
    return [
      ...enrollment.student.guardians.map((guardian) => ({
        userId: guardian.parent.userId,
        type: NotificationType.BUS_NEARBY,
        title,
        body,
        href: `/track/${busId}`,
      })),
      {
        userId: enrollment.student.user.id,
        type: NotificationType.BUS_NEARBY,
        title,
        body,
        href: `/track/${busId}`,
      },
    ];
  });

  await notifyMany(inputs);
}

/** "3 minutes" / "40 seconds" — the part a family actually acts on. */
function etaPhrase(seconds: number): string {
  if (seconds <= 45) return "a moment";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Trim dedup rows older than the retention window.
 *
 * Runs on boot, next to the simulator-flag sweep. The table only exists to stop
 * a repeat alert on the same day, so a row a fortnight old is pure cost — and
 * letting it grow unbounded on a fleet that runs all day is a slow, silent
 * leak that nobody notices until a query gets slow.
 */
export async function pruneOldGeofenceRows(keepDays = KEEP_DAYS): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    cutoff.setHours(0, 0, 0, 0);

    const { count } = await prisma.stopApproach.deleteMany({
      where: { date: { lt: cutoff } },
    });
    if (count > 0) {
      console.log(`  geofence: trimmed ${count} old alert row(s)`);
    }
  } catch (error) {
    // Boot must not fail on a housekeeping task. A database that is not up yet
    // is a normal condition here, exactly as it is for the simulator sweep.
    console.warn(
      "  geofence: could not trim old alert rows",
      error instanceof Error ? error.message : error,
    );
  }
}
