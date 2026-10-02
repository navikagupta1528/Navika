/**
 * Pure logic for driver GPS tracking.
 *
 * This file holds every decision that can be made *about* a position report
 * without touching the network, the database or the DOM, so each one can be
 * unit-tested. `use-driver-tracker.ts` wires the browser's `watchPosition`
 * into these functions; the socket layer just forwards what survives.
 *
 * The hard part of sending a bus's position from a phone is not transmitting
 * it. It is that a phone reports nonsense: a stale fix replayed from cache, a
 * fix with 2 km of accuracy from a basement, or a 300 km/h "jump" when the GPS
 * re-acquires after a tunnel. Every one of those would teleport a bus across
 * the map for a parent watching at home, which is the single most damaging
 * thing this product can do. So a fix has to earn its way in.
 */

// Relative, not `@/lib/...`: this repo's pure modules import their siblings
// relatively so that `vitest run` needs no path-alias config to load them.
import { bearingDegrees, haversineMeters, isValidPoint } from "./geo";

/** A position report, normalised away from the browser's `GeolocationPosition`. */
export type Fix = {
  lat: number;
  lng: number;
  /** Horizontal accuracy in metres, at 68% confidence. */
  accuracyM: number;
  /** Device clock when the fix was taken, in epoch ms. */
  at: number;
  speedKph: number | null;
  headingDeg: number | null;
};

/**
 * The subset of `GeolocationPosition` we read. Structural rather than the DOM
 * type so this file can be imported by a Node test without `lib.dom`.
 */
export type RawPosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  };
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Worse than this and a position cannot describe a bus on a city street. Not
 * rejected outright, just never allowed to *replace* a better fix.
 */
export const MAX_ACCEPTED_ACCURACY_M = 200;

/**
 * Faster than this and it is not a bus. 160 km/h is above the top speed of
 * every vehicle in the fleet, so any implied speed beyond it is a GPS glitch
 * rather than a real jump between two fixes.
 */
export const IMPLAUSIBLE_SPEED_KPH = 160;

/** How far in the past a fix may be dated and still be treated as current. */
export const CLOCK_SKEW_PAST_MS = 60_000;

/**
 * A fix dated in the future is a device clock problem. 30 s of tolerance, not
 * an hour: the client stamps `at` with `Date.now()`, so a wildly wrong future
 * timestamp would also make the marker read as freshly updated forever.
 */
export const CLOCK_SKEW_FUTURE_MS = 30_000;

/**
 * How old a position may be before the UI stops calling the bus live. Mirrors
 * `STALE_AFTER_MS` in the socket server; the server value is authoritative for
 * whether it persists a fix, this one for whether the screen says "live".
 */
export const STALE_AFTER_MS = 2 * 60_000;

/** Below this, a GPS heading is reported but not worth acting on. */
const HEADING_MIN_SPEED_KPH = 3;

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

/**
 * Convert a browser reading into a `Fix`, replacing anything non-numeric with
 * `null` rather than letting `NaN` leak into a payload that will be JSON
 * stringified onto a socket.
 */
export function fixFromPosition(raw: RawPosition | null | undefined): Fix | null {
  if (!raw || !raw.coords) return null;

  const { latitude, longitude, accuracy, speed, heading } = raw.coords;
  if (!isValidPoint({ lat: latitude, lng: longitude })) return null;

  const at = Number(raw.timestamp);
  const accuracyM = Number(accuracy);

  return {
    lat: latitude,
    lng: longitude,
    // An absent accuracy is reported as 0 by some browsers, which would make it
    // look perfect. Treat a missing or nonsense accuracy as "unknown" and let
    // the acceptance rules fall through to the other checks.
    accuracyM: Number.isFinite(accuracyM) && accuracyM >= 0 ? accuracyM : Number.POSITIVE_INFINITY,
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    speedKph: Number.isFinite(speed as number) && (speed as number) >= 0 ? ((speed as number) * 3.6) : null,
    headingDeg: Number.isFinite(heading as number) && (heading as number) >= 0 ? ((heading as number) % 360) : null,
  };
}

// ---------------------------------------------------------------------------
// Deciding whether to believe a fix
// ---------------------------------------------------------------------------

export type FixRejection =
  | "not-a-point"
  | "clock-too-old"
  | "clock-in-future"
  | "too-inaccurate"
  | "teleport";

export type FixVerdict = { accept: true } | { accept: false; reason: FixRejection };

/**
 * Implied ground speed between two fixes, in km/h.
 *
 * Returns `null` when the two fixes share a timestamp or sit in the wrong
 * order: dividing by ~0 would produce an infinite "speed", which would then be
 * rejected as a teleport for the wrong reason — and, worse, a *stationary* bus
 * whose GPS reports the same millisecond twice would be thrown away as junk.
 */
export function impliedSpeedKph(a: Fix, b: Fix): number | null {
  const seconds = (b.at - a.at) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return (haversineMeters(a, b) / 1000 / seconds) * 3600;
}

/**
 * Should this fix replace the previous one?
 *
 * `prev` is the last accepted fix, or `null` when nothing has arrived yet. The
 * checks are ordered cheapest-first, and each one that fires is reported by
 * name, because "the last fix was dropped" is a different problem from the
 * driver and worth saying so in the app instead of silently showing nothing.
 */
export function shouldAcceptFix(prev: Fix | null, next: Fix, nowMs: number): FixVerdict {
  if (!isValidPoint(next)) return { accept: false, reason: "not-a-point" };

  const age = nowMs - next.at;
  if (age > CLOCK_SKEW_PAST_MS) return { accept: false, reason: "clock-too-old" };
  if (age < -CLOCK_SKEW_FUTURE_MS) return { accept: false, reason: "clock-in-future" };

  // A fix this blurry is useless on its own, and worse than useless if it
  // overwrites a sharp one. With nothing to compare against, allow it: on a
  // cold start in a bad spot, a rough position still beats a blank map.
  if (prev && next.accuracyM > MAX_ACCEPTED_ACCURACY_M && next.accuracyM >= prev.accuracyM) {
    return { accept: false, reason: "too-inaccurate" };
  }

  // The teleport guard. A fast bus is fine; a bus crossing the district in one
  // sample is not, and drawing it would be worse than not drawing it.
  if (prev) {
    const speed = impliedSpeedKph(prev, next);
    if (speed !== null && speed > IMPLAUSIBLE_SPEED_KPH) {
      return { accept: false, reason: "teleport" };
    }
  }

  return { accept: true };
}

/**
 * The heading to actually send.
 *
 * `GeolocationPosition.heading` is null whenever the device is not moving, and
 * null more often than not on cheap phones — so falling back to the bearing
 * between the last two accepted fixes is what makes the bus marker rotate at
 * all on most hardware. Stationary fixes keep the previous heading rather than
 * spinning to face north, because a parked bus pointing north is a lie.
 */
export function resolveHeadingDeg(
  prev: Fix | null,
  next: Fix,
  reported: number | null,
): number | null {
  if (reported !== null && Number.isFinite(reported)) return reported % 360;
  if (!prev) return null;

  const speed = impliedSpeedKph(prev, next);
  // Below walking pace the bearing between two fixes is mostly noise.
  if (speed === null || speed < HEADING_MIN_SPEED_KPH) return null;

  return bearingDegrees(prev, next);
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * How much to trust a position, from 1 (just arrived) to 0 (unusable).
 *
 * Drives the marker ring: a bus that stopped reporting must *look* different
 * from a bus sitting at a red light, or the parent cannot tell the difference
 * between "no news" and "no news because the signal died".
 */
export function freshnessFromAge(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  if (ageMs >= STALE_AFTER_MS) return 0;
  return 1 - ageMs / STALE_AFTER_MS;
}

export type FreshnessTone = "emerald" | "amber" | "slate";

export type Freshness = { label: string; tone: FreshnessTone; detail: string };

/** How to describe a position of the given age, in words. */
export function describeFreshness(ageMs: number): Freshness {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { label: "Live", tone: "emerald", detail: "position is current" };
  }
  if (ageMs < 15_000) {
    return { label: "Live", tone: "emerald", detail: "updated just now" };
  }
  if (ageMs < 60_000) {
    const seconds = Math.round(ageMs / 1000);
    return { label: `${seconds}s ago`, tone: "emerald", detail: "position is current" };
  }
  if (ageMs < STALE_AFTER_MS) {
    const minutes = Math.round(ageMs / 60_000);
    return {
      label: `${minutes} min ago`,
      tone: "amber",
      detail: "the driver's phone may have lost signal",
    };
  }
  return {
    label: "No recent signal",
    tone: "slate",
    detail: "this is the last position the driver's phone sent",
  };
}
