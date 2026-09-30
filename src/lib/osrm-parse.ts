/**
 * Pure parsing and cache-key helpers for OSRM.
 *
 * Split out of `osrm.ts` for the same reason `session-core.ts` is split out of
 * `session.ts`: everything here is a function of its arguments, with no
 * database, no network and no `import "server-only"`. That makes it unit
 * testable in a normal Node test run, and it keeps the module that *does* talk
 * to the network down to the part that genuinely has to.
 *
 * The rule for this file: no `prisma`, no `fetch`, no `Date.now()`. If one of
 * those shows up here, the function belongs in `osrm.ts` instead.
 */

/**
 * The pieces of an OSRM route we care about, plus a `maxMeters` sanity bound
 * supplied by the caller so this module needs no configuration of its own.
 */
export type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
};

type OsrmResponse = {
  code: string;
  routes?: OsrmRoute[];
  message?: string;
};

/**
 * Pull distance, duration and geometry out of an OSRM reply.
 *
 * Returns null for anything that does not look like a usable route rather than
 * throwing, because every failure here has the same correct response: fall back
 * to the straight-line estimate. A missing bus ETA is a degraded feature; a 500
 * from the tracking page is a broken one.
 *
 * A response with a plausible distance and duration but unusable geometry is
 * deliberately *not* null. Those two numbers are still worth having, and
 * throwing them away because the drawing part was malformed would be a worse
 * outcome than reporting no geometry.
 */
export function parseOsrm(payload: unknown, maxPlausibleMeters: number): OsrmRoute | null {
  if (typeof payload !== "object" || payload === null) return null;

  const body = payload as OsrmResponse;
  if (body.code !== "Ok" || !Array.isArray(body.routes) || body.routes.length === 0) return null;

  const route = body.routes[0];
  if (!route) return null;

  const { distance, duration, geometry } = route;
  if (typeof distance !== "number" || !Number.isFinite(distance)) return null;
  if (typeof duration !== "number" || !Number.isFinite(duration)) return null;
  if (distance < 0 || duration < 0) return null;
  if (distance > maxPlausibleMeters) return null;

  if (
    typeof geometry !== "object" ||
    geometry === null ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2
  ) {
    return { distance, duration, geometry: { coordinates: [] } };
  }

  return route;
}

/**
 * Read the stored polyline back out of the untyped JSON cache column.
 *
 * Nothing guarantees what is actually in there. A row written before the
 * geometry column existed holds SQL NULL, and a row somebody edited in psql to
 * "fix" a route can hold anything at all. A malformed polyline is therefore
 * treated as no polyline, which downgrades the caller to straight lines instead
 * of throwing on somebody's route page.
 *
 * Validates the coordinates themselves, not just the array shape. A row holding
 * `[["a","b"],[1,2]]` is well-formed JSON and would otherwise be handed
 * straight to MapLibre, where it throws inside the style setter and leaves a
 * permanently blank map with no useful error.
 */
export function parseCachedGeometry(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 2) return null;

  const pairs: [number, number][] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [lng, lat] = pair as [unknown, unknown];
    if (!isCoordinate(lat, lng)) return null;
    pairs.push([lng as number, lat as number]);
  }
  return pairs;
}

/** Latitude/longitude within range, and finite. Duplicated from `geo` on purpose. */
function isCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Coordinate rounding for cache keys.
 *
 * Four decimal places is about 11 m, which is well under the noise of consumer
 * GPS but coarse enough that a bus crawling around a stop does not mint a new
 * cache row on every poll. Without this, live tracking would fill the table
 * with thousands of near-identical rows.
 */
function coordKey(v: number): string {
  return v.toFixed(4);
}

/**
 * Cache key for a route through an ordered list of points.
 *
 * The order is part of the key, not just the set: A-B-C and C-B-A are the same
 * three stops in opposite directions, and they are different journeys with
 * genuinely different distances, durations and road geometry.
 */
export function routeCacheKey(points: { lat: number; lng: number }[]): string {
  const body = points.map((p) => `${coordKey(p.lng)},${coordKey(p.lat)}`).join(";");
  return `route:v1:${body}`;
}

/** Cache key for a single A-to-B lookup. */
export function legCacheKey(from: { lat: number; lng: number }, to: { lat: number; lng: number }): string {
  return `leg:v1:${coordKey(from.lng)},${coordKey(from.lat)};${coordKey(to.lng)},${coordKey(to.lat)}`;
}

/**
 * Join the points into the `lng,lat;lng,lat` form OSRM's `/route` endpoint
 * expects. Note the order: OSRM is GeoJSON-ordered, so longitude first.
 */
export function toOsrmCoords(points: { lat: number; lng: number }[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(";");
}
