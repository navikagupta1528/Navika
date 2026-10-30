/**
 * Geofence rings around a route's stops.
 *
 * Pure: no database, no clock, no network. This module answers exactly one
 * question — "given where the bus is right now, which stops has it *newly*
 * entered a notification ring for?" — and the answer is a list of decisions the
 * caller acts on. Keeping the decision here, separate from the writing and the
 * notifying, is what makes it testable without a running bus.
 *
 * WHY TWO RINGS, AND WHY THEY FIRE IN ORDER
 *
 * A parent at 7:40am does not want one alert. They want a nudge while there is
 * still time to walk to the stop ("about 3 minutes"), and a second one when the
 * bus is actually pulling in ("arriving now"). Two thresholds give that for the
 * price of one distance check:
 *
 *   APPROACHING ~800 m   the bus is on its way; get ready
 *   ARRIVING    ~150 m   the bus is here; go now
 *
 * A bus approaching at city speed crosses 800 m roughly two minutes before it
 * crosses 150 m, so the two rings naturally produce two well-spaced messages.
 *
 * WHY ONLY THE TIGHTEST RING FIRES PER TICK
 *
 * When a position update lands *inside* both rings — a bus that jumped, or the
 * first fix after a phone comes out of a tunnel — only the tighter ring is
 * emitted. Sending both at once would deliver "in about 3 minutes" and "arriving
 * now" in the same breath, which is strictly worse than sending the accurate one.
 * In the ordinary case, where the bus moves a few metres per tick, it crosses the
 * outer ring first and the inner one minutes later, so both still arrive.
 *
 * WHY DEDUP IS THE CALLER'S JOB
 *
 * A bus spends minutes inside the 800 m ring and ticks several times a second.
 * Nothing here says "already told them" — that state lives in the caller (a
 * `StopApproach` row per bus, stop, direction, ring and day), passed in as the
 * `notified` set. Splitting it this way keeps this module free of a database
 * while still making the once-per-run guarantee enforceable and durable across a
 * server restart.
 */

import { haversineMeters, type LatLng } from "./geo";

/** The outer ring: the bus is on its way. */
export const APPROACHING_METERS = 800;
/** The inner ring: the bus is at the stop. */
export const ARRIVING_METERS = 150;

export type GeofenceRing = "APPROACHING" | "ARRIVING";

/** A stop as this module needs it: an id, a label and a position. */
export type GeofenceStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /**
   * The stop's scheduled time on this route, "HH:MM" local, when the college
   * office set one. Optional because a route may legitimately have no schedule,
   * and a stop without one has nothing to be late against.
   */
  scheduledHHMM?: string | null;
};

export type GeofenceDecision = {
  stopId: string;
  stopName: string;
  /** Which ring fired. */
  ring: GeofenceRing;
  /** Metres from the bus to the stop, rounded — for the message and the log. */
  distanceMeters: number;
  /** Road ETA at the same conservative assumption `geo.ts` makes. 0 = here. */
  etaSeconds: number;
};

/**
 * The dedup key for one (bus, stop, direction, ring, day).
 *
 * Exported so the pure module and the database writer cannot drift apart on the
 * format. Both sides build their set with this, so a typo in either is a broken
 * test rather than a silently doubled notification.
 */
export function approachKey(input: {
  busId: string;
  stopId: string;
  direction: string;
  ring: GeofenceRing;
  /** `YYYY-MM-DD`, the calendar day of the run. */
  date: string;
}): string {
  return `${input.busId}|${input.stopId}|${input.direction}|${input.ring}|${input.date}`;
}

/** The calendar day as `YYYY-MM-DD`, in the server's local time. */
export function geofenceDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Which stops the bus has newly entered a ring for on this run.
 *
 * `notified` holds every key from `approachKey` already sent for this bus, stop,
 * direction and day. A stop already notified at a ring is skipped at that ring —
 * and, because the tighter ring is a *different* key, is still free to fire the
 * inner one as the bus draws closer.
 *
 * A bus standing still inside both rings therefore notifies exactly twice per
 * run: once on arrival into the outer ring, once into the inner. Not twice per
 * tick, which is the failure this function exists to prevent.
 */
export function newlyApproaching(input: {
  position: LatLng;
  stops: readonly GeofenceStop[];
  /** Keys already sent, from `approachKey`. */
  notified: ReadonlySet<string>;
  busId: string;
  direction: string;
  /** `YYYY-MM-DD`; defaults to nothing — pass it, this module has no clock. */
  date: string;
}): GeofenceDecision[] {
  const decisions: GeofenceDecision[] = [];

  for (const stop of input.stops) {
    const meters = haversineMeters(input.position, { lat: stop.lat, lng: stop.lng });

    // Nothing to do for a stop the bus is nowhere near. This is the common case
    // on every tick, so it returns before any string is built.
    if (meters > APPROACHING_METERS) continue;

    const ring: GeofenceRing = meters <= ARRIVING_METERS ? "ARRIVING" : "APPROACHING";
    const key = approachKey({
      busId: input.busId,
      stopId: stop.id,
      direction: input.direction,
      ring,
      date: input.date,
    });
    if (input.notified.has(key)) continue;

    decisions.push({
      stopId: stop.id,
      stopName: stop.name,
      ring,
      distanceMeters: Math.round(meters),
      etaSeconds: ring === "ARRIVING" ? 0 : roadEtaSeconds(meters),
    });
  }

  return decisions;
}

/**
 * Road ETA for a straight-line distance, in seconds, at the same conservative
 * assumption `geo.ts` uses for its fallback.
 *
 * Duplicated here rather than imported because `geo.ts` works in point pairs and
 * this runs on an already-measured distance — converting a metre figure back into
 * two coordinates to call it would be roundabout. The constants are the same
 * ones on purpose; if one moves, both must.
 */
function roadEtaSeconds(meters: number): number {
  const roadLike = meters * 1.3;
  const metersPerSecond = (22 * 1000) / 3600;
  return Math.max(30, Math.round(roadLike / metersPerSecond));
}
