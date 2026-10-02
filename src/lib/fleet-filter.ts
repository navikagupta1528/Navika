// Relative, not `@/lib/...`: pure modules in this repo import their siblings
// relatively so `vitest run` needs no path-alias config.
import { describeFreshness, freshnessFromAge } from "./tracking";
// `LIVE_WINDOW_MS` lives in utils, not tracking: it is the *display* window for
// a bus position. Importing it from tracking would silently be `undefined`, and
// `nowMs - undefined` is NaN, so every comparison below would be false and no
// bus would ever be shown.
import { LIVE_WINDOW_MS } from "./utils";

/**
 * The one rule the fleet screens must never get wrong.
 *
 * "Which buses can we show as live right now" is a predicate that the SQL
 * `WHERE` clause, the TypeScript narrowing guard after the query, and the
 * badge text all have to agree on. Expressing it once, as a function the page
 * calls, is what keeps them from drifting: a screen that plots buses from this
 * morning is not a live map, it is a misleading one, and that is a worse bug
 * than an empty screen.
 *
 * The database filter still does the work — it is the only thing that keeps the
 * query cheap — but the decision of *what counts* lives here where it is tested.
 */

/** The fields the predicate needs, which is a subset of the Bus row. */
export type ReportableBus = {
  currentLat: number | null;
  currentLng: number | null;
  lastLocationAt: Date | null;
};

/**
 * Can this bus be drawn as currently moving?
 *
 * A missing coordinate pair means the bus has never reported, and a timestamp of
 * exactly the epoch means it was seeded with a placeholder — which would render
 * as a dot on the coast of Africa and read as a position, so both are excluded
 * rather than special-cased at the call site.
 */
export function isReportable(bus: ReportableBus, nowMs: number): boolean {
  if (bus.currentLat === null || bus.currentLng === null) return false;
  if (bus.lastLocationAt === null) return false;
  if (!Number.isFinite(bus.currentLat) || !Number.isFinite(bus.currentLng)) return false;

  const at = bus.lastLocationAt.getTime();
  if (!Number.isFinite(at)) return false;

  return at >= nowMs - LIVE_WINDOW_MS;
}

/** Narrows a nullable coordinate pair to a drawable one. */
export function hasPosition(
  bus: ReportableBus,
): bus is ReportableBus & { currentLat: number; currentLng: number } {
  return (
    bus.currentLat !== null &&
    bus.currentLng !== null &&
    Number.isFinite(bus.currentLat) &&
    Number.isFinite(bus.currentLng)
  );
}

/** How the screen should describe one bus, or null when it must not be shown. */
export function describeBus(
  bus: ReportableBus,
  nowMs: number,
): { label: string; live: boolean; freshness: number } | null {
  if (!isReportable(bus, nowMs)) return null;

  const ageMs = Math.max(0, nowMs - bus.lastLocationAt!.getTime());
  return {
    label: describeFreshness(ageMs).label,
    live: freshnessFromAge(ageMs) > 0,
    freshness: freshnessFromAge(ageMs),
  };
}
