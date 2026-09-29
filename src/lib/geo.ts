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

/**
 * Fallback ETA when OSRM is unavailable or rate limited.
 *
 * Straight-line distance underestimates real road distance by roughly 30% in a
 * gridded city, so we inflate it and divide by an assumed average speed that
 * accounts for stops, junctions and traffic lights. Deliberately conservative:
 * a bus ETA that is too optimistic is worse than one that is too pessimistic.
 */
export function estimateEtaMinutes(
  from: LatLng,
  to: LatLng,
  averageSpeedKph = 22,
): number {
  const straight = haversineMeters(from, to);
  const roadLike = straight * 1.3;
  const metersPerMinute = (averageSpeedKph * 1000) / 60;
  return Math.max(1, Math.round(roadLike / metersPerMinute));
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
