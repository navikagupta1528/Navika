/**
 * The driving watcher: turns a bus's GPS stream into a driver safety score.
 *
 * The geofence, boarding and delay watchers all answer "where is the bus". This
 * one answers "how is it being driven", which is the question a fleet manager
 * actually has at the end of the week.
 *
 * WHAT IT KEEPS, AND WHAT IT DOES NOT
 *
 * Classification needs the fix *before* the current one, so the previous fix
 * per bus is held in memory. That is the minimum the decision needs and it is
 * meaningless a moment later, so it is not persisted — `Bus` already stores the
 * last-known position, and a second copy would be a second thing to keep in
 * step. The *events* are persisted, because they are the audit trail a manager
 * asks for when a score looks wrong.
 *
 * WHY THE PREVIOUS FIX IS IN MEMORY AND THE EVENTS ARE NOT
 *
 * A missed classification after a restart costs one event; a lost event costs
 * the manager's ability to explain a score. The asymmetry is the whole reason
 * the split exists.
 *
 * NEVER THROWS
 *
 * Same contract as the other watchers. Scoring is a report about the past; it
 * must never unwind the driver's location ping.
 */

import { prisma } from "@/lib/db";
import { classifyFix, type DrivingFix } from "@/lib/driving";

/** The previous fix per bus, for classification. Bounded by the fleet size. */
const lastFix = new Map<string, DrivingFix>();

export type DrivingInput = {
  busId: string;
  /** The trip's driver, when there is a real trip. Null for a simulation. */
  driverId: string | null;
  tripId: string | null;
  fix: DrivingFix;
};

export async function evaluateDriving(input: DrivingInput): Promise<void> {
  try {
    const previous = lastFix.get(input.busId);
    // Record the current fix regardless, so the next tick has something to
    // compare against even if this one throws.
    lastFix.set(input.busId, input.fix);

    // The first fix for a bus has nothing to be compared to.
    if (!previous) return;

    const events = classifyFix(previous, input.fix);
    if (events.length === 0) return;

    await prisma.drivingEvent.createMany({
      data: events.map((event) => ({
        busId: input.busId,
        driverId: input.driverId,
        tripId: input.tripId,
        type: event.type,
        magnitudeKph: event.magnitudeKph,
        lat: input.fix.lat,
        lng: input.fix.lng,
        at: new Date(event.at),
      })),
    });
  } catch (error) {
    console.error("[driving] evaluation failed:", error);
  }
}

/**
 * Forget a bus's previous fix.
 *
 * Called when a trip ends, so the first fix of the next run is not compared
 * against the last fix of the previous one — a bus that was parked overnight
 * and then pulled away must not be scored for the pull-away as if it were a
 * continuation of yesterday's braking.
 */
export function resetDrivingMemory(busId: string): void {
  lastFix.delete(busId);
}
