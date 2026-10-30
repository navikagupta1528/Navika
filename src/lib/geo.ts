/**
 * Geospatial helpers. Pure functions, no server-only import, so they can be
 * unit tested and reused on the client for smooth marker animation.
 */

const EARTH_RADIUS_M = 6_371_000;

export type LatLng = { lat: number; lng: number };

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, in degrees clockwise from north. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (d: number) => (d * 180) / Math.PI;

  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point at a fraction t (0..1) along the straight line from a to b. */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Road distance runs ~30% over straight-line in a gridded city. */
const ROAD_INFLATION = 1.3;

/**
 * Fallback ETA when OSRM is unavailable or rate limited.
 *
 * Straight-line distance underestimates real road distance by roughly 30% in a
 * gridded city, so we inflate it and divide by an assumed average speed that
 * accounts for stops, junctions and traffic lights. Deliberately conservative:
 * a bus ETA that is too optimistic is worse than one that is too pessimistic.
 *
 * Returns whole minutes. `estimateEtaSeconds` is the same estimate at sub-minute
 * resolution, for countdowns that need to tick rather than jump.
 */
export function estimateEtaMinutes(
  from: LatLng,
  to: LatLng,
  averageSpeedKph = 22,
): number {
  return Math.max(1, Math.round(estimateEtaSeconds(from, to, averageSpeedKph) / 60));
}

/**
 * The same estimate as `estimateEtaMinutes`, in seconds.
 *
 * Added for the arrival countdown, which ticks down every second between bus
 * pings. Rounding to whole minutes first — then counting down — would produce a
 * number that leaps a minute at a time and disagrees with the socket by up to
 * sixty seconds. The floor is 30 s rather than 1 min so that "arriving" and "1
 * min" are distinguishable: a bus 40 s away is not the same message as one that
 * is already at the kerb.
 */
export function estimateEtaSeconds(
  from: LatLng,
  to: LatLng,
  averageSpeedKph = 22,
): number {
  const straight = haversineMeters(from, to);
  const roadLike = straight * ROAD_INFLATION;
  const metersPerSecond = (averageSpeedKph * 1000) / 3600;
  return Math.max(30, Math.round(roadLike / metersPerSecond));
}

/** Bounding box that contains every point, for fitting the map viewport. */
export function boundsOf(points: LatLng[]): {
  sw: LatLng;
  ne: LatLng;
} | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    sw: { lat: Math.min(...lats), lng: Math.min(...lngs) },
    ne: { lat: Math.max(...lats), lng: Math.max(...lngs) },
  };
}

/* -------------------------------------------------------------------------- */
/* Map rendering support                                                       */
/*                                                                            */
/* Everything above answers "how far / how long". Everything below answers      */
/* "where on screen", which is the half that the map component needs and the   */
/* half that is only obvious once you have tried to get it wrong.              */
/* -------------------------------------------------------------------------- */

/**
 * A coordinate a map will actually accept.
 *
 * Rejects `NaN`, `Infinity` and out-of-range values, which is exactly what an
 * empty required form field parses to. Handing `NaN` to MapLibre throws inside
 * the style setter and leaves the map permanently blank with no useful error,
 * so this is checked on the way in rather than trusted.
 */
export function isValidCoord(lat: unknown, lng: unknown): boolean {
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

export function isValidPoint(p: unknown): p is LatLng {
  if (typeof p !== "object" || p === null) return false;
  const { lat, lng } = p as Partial<LatLng>;
  return isValidCoord(lat, lng);
}

/**
 * Metres per degree of longitude at a given latitude.
 *
 * Factored out because it is the one number that quietly breaks naive planar
 * maths: two stops 0.002 degrees apart are 220 m apart in longitude at the
 * equator and 180 m in Pune, and the difference grows toward the poles.
 */
function metersPerDegreeLng(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

const METERS_PER_DEGREE_LAT = 111_132;

/**
 * Shortest distance from `p` to the segment `a`–`b`, in metres.
 *
 * Projected into a local metre-ish plane rather than solved in 3D: over the few
 * hundred metres a single stop segment spans, ignoring curvature is well below
 * consumer GPS error, and a planar projection is both cheaper and far easier
 * to reason about than the spherical case.
 *
 * The projection parameter is clamped to [0, 1], so a point dragged past the
 * end of a segment measures to the endpoint instead of mirroring to an
 * imaginary continuation. That matters for reordering: a marker pulled off
 * the end of the route has to land on the last stop, not somewhere off it.
 */
export function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const mLng = metersPerDegreeLng(a.lat);

  // Offsets from `a`, not absolute metre coordinates. Only differences matter
  // for a distance, and projecting relative to the anchor keeps the numbers
  // small enough that float error stays negligible.
  const dx = (b.lng - a.lng) * mLng;
  const dy = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
  const px = (p.lng - a.lng) * mLng;
  const py = (p.lat - a.lat) * METERS_PER_DEGREE_LAT;

  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return haversineMeters(p, a);

  const t = clamp01((px * dx + py * dy) / lengthSq);
  return Math.hypot(px - t * dx, py - t * dy);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export type NearestOnLine = {
  /** Metres from the point to the line. */
  distance: number;
  /**
   * How far along the line the point sits: 0 at the first vertex, 1 at the
   * last.
   *
   * This is the value reordering is built on. Deciding which slot a dragged
   * marker belongs in from its position *along the route* rather than from its
   * pixel position is what stops the marker jumping to a neighbouring stop when
   * the route doubles back on itself in a tight grid.
   */
  t: number;
  /** Index of the segment the projection fell on, 0-based. */
  segment: number;
};

/**
 * Project a point onto a polyline.
 *
 * Returns null only for an empty line. `t` is measured in distance, not in
 * vertices, so a route with one long hop and one short one still gives a `t`
 * that means "how far the bus has to drive".
 */
export function nearestOnPolyline(p: LatLng, line: LatLng[]): NearestOnLine | null {
  if (line.length === 0) return null;

  // Cumulative distance per vertex, so `t` is free and distance-weighted.
  const cumulative: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    cumulative.push(cumulative[i - 1]! + haversineMeters(line[i - 1]!, line[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return { distance: haversineMeters(p, line[0]!), t: 0, segment: 0 };

  let best: NearestOnLine | null = null;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const distance = distanceToSegmentMeters(p, a, b);
    if (best !== null && distance >= best.distance) continue;

    // Recompute the within-segment fraction from the same projection the
    // distance used, so the two can never disagree about where the point is.
    const mLng = metersPerDegreeLng(a.lat);
    const dx = (b.lng - a.lng) * mLng;
    const dy = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
    const px = (p.lng - a.lng) * mLng;
    const py = (p.lat - a.lat) * METERS_PER_DEGREE_LAT;
    const lengthSq = dx * dx + dy * dy;

    const within = lengthSq > 0 ? clamp01((px * dx + py * dy) / lengthSq) : 0;
    const segmentLength = cumulative[i + 1]! - cumulative[i]!;

    best = {
      distance,
      t: (cumulative[i]! + within * segmentLength) / total,
      segment: i,
    };
  }

  return best;
}

/**
 * Which stop slot a point dragged onto this line should drop into.
 *
 * Because `t` is proportional distance along the route and the stops are evenly
 * spaced *along the route*, `t * (n - 1)` is the slot. Clamped so a marker
 * dragged past either end joins the end stop rather than falling off the route.
 */
export function slotFromT(t: number, stopCount: number): number {
  if (stopCount <= 1) return 0;
  // `Math.max(0, Math.min(n, NaN))` is NaN, not 0 — every clamp of NaN fails
  // silently because every comparison with NaN is false. Guard it explicitly,
  // so a bad coordinate degrades to "no reordering" rather than to an index
  // that reaches `splice`.
  if (!Number.isFinite(t)) return 0;
  const raw = Math.round(t * (stopCount - 1));
  return Math.max(0, Math.min(stopCount - 1, raw));
}

/**
 * Move the item at `from` so it ends up at `to`.
 *
 * Returns a new array; the input is never touched. That is not stylistic —
 * React compares array identity, so mutating in place and setting the same
 * reference leaves the reordered list on screen unchanged.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/** Viewport that frames every point, ready to hand to MapLibre. */
export type Viewport = { center: LatLng; zoom: number };

/**
 * Centre and zoom that frame a set of points.
 *
 * The single-point case gets a fixed close zoom instead of a computed one:
 * "fit bounds" on a zero-size box is meaningless and MapLibre answers it by
 * jumping to the world view, which is useless for looking at one bus stop.
 *
 * Zoom is picked from the *span* rather than derived from a pixel viewport,
 * because the map's dimensions are not known during server rendering.
 */
export function viewportFor(points: LatLng[], fallback: Viewport): Viewport {
  const bounds = boundsOf(points);
  if (!bounds) return fallback;

  // Pad by a share of the box's own size so markers on the edge are not clipped
  // by the container, with a floor so a tight cluster still gets breathing room.
  const padLat = Math.max((bounds.ne.lat - bounds.sw.lat) * 0.15, 0.0015);
  const padLng = Math.max((bounds.ne.lng - bounds.sw.lng) * 0.15, 0.0015);
  const minLat = bounds.sw.lat - padLat;
  const maxLat = bounds.ne.lat + padLat;
  const minLng = bounds.sw.lng - padLng;
  const maxLng = bounds.ne.lng + padLng;

  return {
    center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
    zoom: spanToZoom(maxLat - minLat, maxLng - minLng),
  };
}

function spanToZoom(spanLat: number, spanLng: number): number {
  const span = Math.max(spanLat, spanLng, 0.0005);
  if (span < 0.01) return 16;
  if (span < 0.03) return 15;
  if (span < 0.08) return 14;
  if (span < 0.2) return 13;
  if (span < 0.5) return 12;
  if (span < 1.2) return 11;
  if (span < 3) return 10;
  if (span < 8) return 9;
  return 8;
}

/** "450 m" below a kilometre, one decimal above it: "1.4 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Length of a polyline in metres. */
export function lineLengthMeters(line: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += haversineMeters(line[i - 1]!, line[i]!);
  }
  return total;
}

/** MapLibre's coordinate order is `[lng, lat]`; the database's is the reverse. */
export function toLngLat(p: LatLng): [number, number] {
  return [p.lng, p.lat];
}

/** Inverse of `toLngLat`, for reading coordinates back off a map event. */
export function fromLngLat(pair: [number, number]): LatLng {
  return { lng: pair[0], lat: pair[1] };
}
