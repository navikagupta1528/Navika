/**
 * "The bus left without your child." — the decision, as arithmetic.
 *
 * Pure: no database, no clock, no network. Given where the bus is, the stops it
 * has already served this run and the ones it has already been reported as
 * leaving, this answers one question — *which stops has it now departed?* —
 * and hands back a list the caller acts on.
 *
 * WHY A DEPARTURE IS A SEPARATE EVENT FROM AN ARRIVAL
 *
 * `geofence.ts` only knows about buses drawing *near*. The alert that matters
 * most to a family is the opposite: the bus came, and then it went, and the
 * child who pressed "I'm waiting" is still standing there. That cannot be
 * inferred from the arrival rings alone — a bus that is 400 m past a stop looks
 * exactly like a bus that is 400 m from it — so it is its own event with its
 * own ring, keyed into the same `StopApproach` table so it inherits the same
 * once-per-run, durable-across-restarts guarantee.
 *
 * WHY A STOP MUST HAVE BEEN ARRIVED-AT FIRST
 *
 * Only a stop the bus actually came to (~150 m) can be *left*. Keying off the
 * arrival ring rather than off raw distance is what keeps this from firing when
 * a bus simply drives past on the other side of a divided road, or when the
 * route runs 400 m away from a stop it never serves. The false negative — an
 * occasional unreported departure — is far cheaper than the false positive: a
 * parent who is told their waiting child was left behind when the bus never
 * stopped will stop believing the alerts.
 *
 * WHY THIS IS ITS OWN FILE AND NOT PART OF `geofence.ts`
 *
 * They answer different questions over the same inputs and share nothing but a
 * distance helper. Merging them would make each harder to read to save a line
 * of import.
 */

import { haversineMeters, type LatLng } from "./geo";
import { ARRIVING_METERS } from "./geofence";

/**
 * How far past a stop the bus must be before it counts as having left.
 *
 * Deliberately a good deal wider than the ~150 m arrival ring, and comfortably
 * wider than a GPS jitter or a single bad fix. A bus idling at the kerb drifts
 * tens of metres between fixes; requiring a clear 300 m of separation means it
 * has to genuinely pull away before any family is told anything.
 */
export const DEPARTED_METERS = 300;

/** A stop as this module needs it. */
export type BoardingStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type DepartureDecision = {
  stopId: string;
  stopName: string;
  /** Metres from the bus to the stop *now*, rounded — for the message and log. */
  distanceMeters: number;
};

/**
 * Which stops the bus has now left, having first arrived at them this run.
 *
 * `arrived` holds the stop ids the bus came within `ARRIVING_METERS` of, and
 * `departed` the ones already reported as left. A stop in neither cannot have
 * been departed; a stop in `departed` has already been reported and must not be
 * reported again.
 */
export function newlyDeparted(input: {
  position: LatLng;
  stops: readonly BoardingStop[];
  /** Stop ids the bus has already arrived at this run, from the ARRIVING ring. */
  arrived: ReadonlySet<string>;
  /** Stop ids already reported departed this run. */
  departed: ReadonlySet<string>;
  /** Override for tests; defaults to `DEPARTED_METERS`. */
  departedAfterMeters?: number;
}): DepartureDecision[] {
  const threshold = input.departedAfterMeters ?? DEPARTED_METERS;
  const decisions: DepartureDecision[] = [];

  for (const stop of input.stops) {
    // The common case on every tick: the bus is nowhere near this stop, or it
    // has not been served yet, or it has already been reported. Any of those
    // returns before a distance is even measured.
    if (!input.arrived.has(stop.id)) continue;
    if (input.departed.has(stop.id)) continue;

    const meters = haversineMeters(input.position, { lat: stop.lat, lng: stop.lng });
    if (meters <= threshold) continue;

    decisions.push({
      stopId: stop.id,
      stopName: stop.name,
      distanceMeters: Math.round(meters),
    });
  }

  return decisions;
}

/**
 * The pickup statuses a departure can resolve a record to.
 *
 * The same five words as the Prisma `PickupStatus`, spelled out rather than
 * imported so this module stays free of the generated client and unit-testable
 * without a database — the same reason `geofence.ts` spells `Direction` as a
 * string.
 */
export type BoardingStatus = "PENDING" | "WAITING" | "PICKED" | "MISSED" | "ABSENT";

/**
 * What a departure means for one student's pickup record.
 *
 * The distinction is the whole point of the enum, and it is what turns a
 * departure into a *safety* signal rather than a bookkeeping one:
 *
 *   WAITING -> MISSED   they were standing at the stop and the bus left without
 *                       them. This is the one that must reach a guardian.
 *   PENDING -> ABSENT   they were never marked waiting, so the bus left on
 *                       schedule and they simply were not there. Attendance
 *                       bookkeeping, not an alarm.
 *   PICKED  -> null     they are already on the bus. A record can be resolved
 *                       after the bus pulls away from the stop that boarded
 *                       them, so "departed" must never demote a child who was
 *                       ticked off.
 *   MISSED/ABSENT -> null   already resolved; never re-resolve.
 */
export function departureOutcome(status: BoardingStatus): "MISSED" | "ABSENT" | null {
  if (status === "WAITING") return "MISSED";
  if (status === "PENDING") return "ABSENT";
  return null;
}

/** True when a departure should raise a safety alert rather than just a tally. */
export function isSafetyCritical(outcome: "MISSED" | "ABSENT" | null): boolean {
  return outcome === "MISSED";
}

/**
 * Guards a stop needs to be able to raise the alarm, for a message that is
 * actually actionable at 7:40am.
 *
 * `ARRIVING_METERS` is re-exported so a caller reasoning about "was this stop
 * served?" uses the same threshold the arrival ring used, rather than a copy of
 * the number that can drift away from it.
 */
export { ARRIVING_METERS };
