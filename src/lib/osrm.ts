import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { estimateEtaMinutes, fromLngLat, haversineMeters, type LatLng } from "@/lib/geo";
import {
  legCacheKey,
  parseCachedGeometry,
  parseOsrm,
  routeCacheKey,
  toOsrmCoords,
  type OsrmRoute,
} from "@/lib/osrm-parse";

export { legCacheKey, routeCacheKey };

/**
 * Road routing via OSRM, with a durable cache.
 *
 * WHY THIS EXISTS
 *
 * A bus route drawn as straight lines between stops is the single clearest
 * signal that a transport system is a demo. Real roads are not straight lines,
 * and a parent looking at a map wants to see where the bus actually is relative
 * to the roads. OSRM's public instance returns true road-following geometry
 * for free and needs no API key, which is exactly the right trade for a
 * project that has to run somewhere other than a laptop.
 *
 * WHY EVERYTHING IS CACHED
 *
 * The public instance is shared and rate limited, and it is not ours to abuse.
 * Bus routes and live positions are also highly repetitive: the same handful of
 * routes are queried over and over, and live tracking polls a moving target
 * every few seconds per bus. Caching in Postgres rather than in memory means
 * the cache survives a deploy and works across every process.
 *
 * `EtaCache.cacheKey` is the unique column doing the deduplication work.
 */

const OSRM_URL = process.env.OSRM_URL ?? "https://router.project-osrm.org";

/** Shortest sane trip. Below this the bus is already at the stop. */
const MIN_METERS = 10;
/** One degree of latitude, in metres. Used to reject absurd OSRM responses. */
const MAX_PLAUSIBLE_METERS = 3_000_000;
/**
 * Give up rather than hang a page render. The public instance occasionally
 * takes several seconds under load, and a tracking page that renders after 8
 * seconds is worse than one that renders now with an estimate.
 */
const TIMEOUT_MS = 5_000;

export type EtaResult = {
  seconds: number;
  meters: number;
  source: "osrm" | "haversine";
};

/** How long a cached answer stays fresh before we ask OSRM again. */
const ROUTE_TTL_SECONDS = 6 * 60 * 60;
const LEG_TTL_SECONDS = 30 * 60;

/** A cache row, plus the road-following polyline when it has one. */
type CachedResult = EtaResult & { geometry: [number, number][] | null };

/**
 * Read a cached result, if one is there and still fresh.
 *
 * `computedAt` is stored honestly as the moment the answer was calculated, and
 * staleness is decided here rather than by backdating the column. Backdating
 * would have saved this comparison, but it makes the stored timestamp a lie:
 * every other reader of `EtaCache`, including a future admin report asking
 * "how fresh are these numbers", would have to know the backdating convention
 * to interpret it.
 *
 * A `haversine` row is allowed a longer life than an `osrm` row, because the
 * straight-line estimate does not depend on traffic or roadworks and is not
 * going to be wrong about them for a long time.
 */
async function readCache(cacheKey: string): Promise<CachedResult | null> {
  const row = await prisma.etaCache.findUnique({ where: { cacheKey } });
  if (!row) return null;

  const source = row.source === "osrm" ? "osrm" : "haversine";
  const ttl = source === "osrm" ? ROUTE_TTL_SECONDS : LEG_TTL_SECONDS;
  const ageSeconds = (Date.now() - row.computedAt.getTime()) / 1000;
  if (ageSeconds > ttl) return null;

  return {
    seconds: row.seconds,
    meters: row.meters ?? 0,
    source,
    geometry: parseCachedGeometry(row.geometry),
  };
}

/**
 * Store a result, with the polyline when there is one.
 *
 * Geometry is passed as the bare `[lng, lat]` pairs so the stored shape matches
 * what OSRM returned, which means a future change to how it is interpreted does
 * not have to migrate every cached row.
 */
async function writeCache(
  cacheKey: string,
  result: EtaResult,
  geometry?: [number, number][] | null,
): Promise<void> {
  const geometryValue =
    geometry && geometry.length >= 2 ? (geometry as Prisma.InputJsonValue) : Prisma.JsonNull;

  try {
    await prisma.etaCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        seconds: result.seconds,
        meters: Math.round(result.meters),
        source: result.source,
        // A nullable Json column cannot be written as a bare `null`: Prisma
        // reads that as "leave this field alone" on an update and rejects it on
        // a create. `Prisma.JsonNull` is the explicit "store SQL NULL here".
        geometry: geometryValue,
      },
      update: {
        seconds: result.seconds,
        meters: Math.round(result.meters),
        source: result.source,
        geometry: geometryValue,
        computedAt: new Date(),
      },
    });
  } catch {
    // A cache write failing must never fail the page that triggered it. The
    // routing result itself is still correct; we just paid for it twice.
  }
}

async function fetchOsrm(path: string): Promise<OsrmRoute | null> {
  try {
    const response = await fetch(`${OSRM_URL}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Required by the OSRM demo instance. A browser will not let us
        // override User-Agent, but these two are settable and are what the
        // service actually reads for identification.
        "X-Requested-With": "busguard",
        Accept: "application/json",
      },
      // Next caches fetch results by default, but this URL is not in the
      // Next cache configuration and the value is already in Postgres, so
      // opt out and let the cache key do the work.
      cache: "no-store",
    });

    if (!response.ok) return null;
    return parseOsrm(await response.json(), MAX_PLAUSIBLE_METERS);
  } catch {
    // Network failure, timeout, DNS, or malformed JSON. All the same to us.
    return null;
  }
}

/** Straight-line total for a multi-point path, used when OSRM is unavailable. */
function straightLineDistance(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * Road distance, duration and geometry through an ordered list of points.
 *
 * Requires at least two points; returns null below that, because there is no
 * route between fewer than two places and the caller is better off knowing
 * that than receiving a fabricated zero.
 *
 * `line` always contains something drawable. `source` describes what produced
 * the *numbers*, and the two are deliberately reported separately: a
 * straight-line polyline is always labelled `"haversine"`, so a caller can never
 * claim a road distance while drawing a line that ignores the roads.
 */
export async function getRouteGeometry(
  points: LatLng[],
): Promise<{ seconds: number; meters: number; source: "osrm" | "haversine"; line: LatLng[] } | null> {
  if (points.length < 2) return null;

  const cacheKey = routeCacheKey(points);
  const cached = await readCache(cacheKey);

  // A cached row is only usable if it has something to draw *and* that drawing
  // is real road geometry. A row that claims OSRM but has no polyline — written
  // before the geometry column existed, say — is not a cache hit at all. Using
  // it anyway would render straight lines under a "13 km by road" caption for
  // the rest of the TTL, which is the exact failure this check prevents.
  if (cached?.source === "osrm" && cached.geometry) {
    return {
      seconds: cached.seconds,
      meters: cached.meters,
      source: "osrm",
      line: cached.geometry.map(fromLngLat),
    };
  }

  const path = `/route/v1/driving/${toOsrmCoords(points)}?overview=full&geometries=geojson`;
  const route = await fetchOsrm(path);

  if (!route) {
    const straight = straightLineDistance(points);
    const fallback: EtaResult = {
      seconds: estimateEtaMinutes(points[0]!, points[points.length - 1]!),
      meters: straight,
      source: "haversine",
    };
    // Only cache the fallback if there is no OSRM answer at all. Caching it
    // over a good cached answer would throw away real road data because the
    // routing server blipped.
    if (!cached) await writeCache(cacheKey, fallback);
    return { ...fallback, line: points };
  }

  const result: EtaResult = {
    seconds: Math.round(route.duration),
    // Rounded here, not only on the way into the cache. Otherwise a fresh fetch
    // returns `13268.4321` and a cached read returns `13268` for the same
    // route, and the answer to "how far is this route" quietly depends on
    // whether the cache happened to be warm. Nothing downstream needs
    // sub-metre precision from a car on roads.
    meters: Math.round(route.distance),
    source: "osrm",
  };
  const line = route.geometry.coordinates;

  if (line.length < 2) {
    // A distance and a duration with no drawable path. The numbers are still
    // worth caching, but the line is not road geometry, so the result is
    // reported as an estimate rather than dressed up as one.
    await writeCache(cacheKey, { ...result, source: "haversine" });
    return { ...result, source: "haversine", line: points };
  }

  await writeCache(cacheKey, result, line);
  return { ...result, line: line.map(fromLngLat) };
}

/**
 * Travel time and road distance between two points.
 *
 * The workhorse behind the "bus is 6 minutes away" figure on the parent and
 * driver screens.
 */
export async function getLegEta(from: LatLng, to: LatLng): Promise<EtaResult> {
  const straight = haversineMeters(from, to);

  // Already there. Rounding before this check produced an ETA of 1 minute for
  // a bus standing on its stop, which is worse than saying nothing.
  if (straight < MIN_METERS) return { seconds: 0, meters: straight, source: "haversine" };

  const cacheKey = legCacheKey(from, to);
  const cached = await readCache(cacheKey);
  if (cached?.source === "osrm") {
    // Legs are requested with `overview=false`, so there is no geometry to
    // carry. Rebuilding the result rather than returning the row directly keeps
    // the untyped-JSON parsing out of this function's return type.
    return { seconds: cached.seconds, meters: cached.meters, source: cached.source };
  }

  const path = `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  const route = await fetchOsrm(path);

  if (!route) {
    const fallback: EtaResult = {
      seconds: estimateEtaMinutes(from, to),
      meters: straight,
      source: "haversine",
    };
    if (!cached) await writeCache(cacheKey, fallback);
    return fallback;
  }

  const result: EtaResult = {
    seconds: Math.round(route.duration),
    meters: Math.round(route.distance),
    source: "osrm",
  };
  await writeCache(cacheKey, result);
  return result;
}

/**
 * ETA from a moving bus to a fixed stop.
 *
 * Same as `getLegEta`, but it skips the cache for close pairs. Live tracking
 * calls this every few seconds per bus, and a bus 300 m from the stop would
 * otherwise mint a fresh cache row per poll for an answer that is about to
 * change anyway. Beyond that distance the route does not meaningfully change
 * from one poll to the next, so the cache still applies.
 */
export async function getLiveEta(from: LatLng, to: LatLng): Promise<EtaResult> {
  const straight = haversineMeters(from, to);
  if (straight < MIN_METERS) return { seconds: 0, meters: straight, source: "haversine" };

  // Inside roughly a city block the answer is dominated by "which side of the
  // junction am I on", not by the road network. Skip the round trip.
  if (straight < 400) {
    return { seconds: estimateEtaMinutes(from, to), meters: straight, source: "haversine" };
  }

  return getLegEta(from, to);
}
