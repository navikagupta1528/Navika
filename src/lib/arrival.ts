/**
 * The arrival countdown, as arithmetic.
 *
 * Pure: no React, no socket, no clock of its own. Given a bus's last known fix,
 * the stop it is heading to and the current time, it returns what the countdown
 * should read. The component that renders it and the map popup that repeats it
 * both call in here, so the two can never show different numbers for the same
 * bus — and the whole thing is testable without a browser.
 *
 * Relative sibling imports, not `@/lib/...`: this module is unit tested and
 * Vitest has no path-alias configuration here. Same reason `simulator.ts` and
 * `geofence.ts` do it.
 */

import { estimateEtaSeconds, haversineMeters, type LatLng } from "./geo";
import { APPROACHING_METERS } from "./geofence";
import { LIVE_WINDOW_MS } from "./utils";

/** A position with the server clock reading that came with it. */
export type ArrivalFix = { lat: number; lng: number; at: number };

/** The stop the viewer is waiting at. Null when there is nobody to measure to. */
export type ArrivalStop = { name: string; lat: number; lng: number } | null;

export type ArrivalReading =
  /** A fresh fix: a real countdown. */
  | { kind: "live"; seconds: number; distanceMeters: number }
  /**
   * The last fix is older than the live window. Deliberately a distinct state
   * rather than a countdown that keeps falling: a bus that stopped reporting an
   * hour ago must not keep ticking towards zero, and the number a parent is
   * looking at is the last place that lie would be noticed.
   */
  | { kind: "stale"; distanceMeters: number }
  /** Nothing to show yet — no fix, and the server had no estimate either. */
  | { kind: "none" };

/**
 * Read the countdown.
 *
 * `initialEtaMinutes` is the server's own first figure. It is the fallback for
 * the case where the browser has not received a socket position yet — a page
 * opened a second before the next ping — so the first frame shows a real number
 * instead of a dash. Once a fix arrives it takes over.
 */
export function readArrival(input: {
  fix: ArrivalFix | null;
  stop: ArrivalStop;
  now: number;
  initialEtaMinutes: number | null;
  staleAfterMs?: number;
}): ArrivalReading {
  const staleAfterMs = input.staleAfterMs ?? LIVE_WINDOW_MS;

  // An admin watching the whole route has no single stop to measure to. All we
  // can honestly offer is the server's estimate.
  if (!input.stop) return fromInitial(input.initialEtaMinutes);

  if (!input.fix) return fromInitial(input.initialEtaMinutes);

  const target: LatLng = { lat: input.stop.lat, lng: input.stop.lng };
  const from: LatLng = { lat: input.fix.lat, lng: input.fix.lng };
  const distanceMeters = haversineMeters(from, target);
  const ageMs = Math.max(0, input.now - input.fix.at);

  if (ageMs > staleAfterMs) return { kind: "stale", distanceMeters };

  // Decay the estimate by the age of the fix: a bus that pinged eight seconds
  // ago is eight seconds closer than the estimate computed from that fix alone
  // implies. Without this the countdown sits still between pings, which is the
  // defect this feature exists to fix — it would just move the frozen number
  // from the server to the client.
  const base = estimateEtaSeconds(from, target);
  const seconds = Math.max(0, base - ageMs / 1000);

  return { kind: "live", seconds, distanceMeters };
}

function fromInitial(initialEtaMinutes: number | null): ArrivalReading {
  if (initialEtaMinutes === null) return { kind: "none" };
  return { kind: "live", seconds: initialEtaMinutes * 60, distanceMeters: 0 };
}

/**
 * How full the progress bar should be, 0..1.
 *
 * Zero when the bus is at or beyond the outer ring, one when it is at the stop.
 * Clamped, because a bus that has overshot its stop must not draw a bar past the
 * end — it has served the stop and the bar belongs full, not inverted.
 */
export function approachFraction(distanceMeters: number | null): number {
  if (distanceMeters === null) return 0;
  return Math.min(1, Math.max(0, 1 - distanceMeters / APPROACHING_METERS));
}

export type CountdownTone = "far" | "near" | "here";

/**
 * "now" / "45 sec" / "1:40 min" / "12 min", plus how urgent it is.
 *
 * Under two minutes the seconds are shown, because that is the window where they
 * change what a parent does. Above it they are noise that re-renders every
 * second and makes the number harder to read at a glance.
 */
export function formatCountdown(seconds: number): {
  value: string;
  unit: string;
  tone: CountdownTone;
} {
  if (seconds <= 10) return { value: "now", unit: "", tone: "here" };

  if (seconds < 60) {
    return { value: `${Math.round(seconds)}`, unit: "sec", tone: "near" };
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 2) {
    const secs = Math.round(seconds % 60);
    return { value: `${minutes}:${`${secs}`.padStart(2, "0")}`, unit: "min", tone: "near" };
  }

  return {
    value: `${Math.ceil(seconds / 60)}`,
    unit: "min",
    tone: minutes <= 5 ? "near" : "far",
  };
}
