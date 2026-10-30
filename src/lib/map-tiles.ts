/**
 * Which map tile server the browser should use, and whether that choice is safe
 * to ship.
 *
 * The map is a first-class screen and its tiles are the one dependency this
 * project does not own. The default below is OpenStreetMap's public tile server,
 * which is correct for development and explicitly not for production: OSM's tile
 * usage policy forbids a heavy application, throttles or blocks it, and the
 * failure mode is a grey map rather than an error anyone can read.
 *
 * `NEXT_PUBLIC_MAP_TILE_URL` is inlined at build time, so this cannot be a
 * runtime check on the server - it has to be decided in the browser bundle,
 * which is why the notice is a console warning rather than a thrown error. A
 * blank map would be worse than a throttled one, so the app still comes up.
 */

/** OSM's shared server. Fine to develop against, not fine to ship. */
export const OSM_PUBLIC_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** The URL actually used, given whatever the build was configured with. */
export function resolveMapTileUrl(configured: string | undefined): string {
  const value = configured?.trim();
  return value ? value : OSM_PUBLIC_TILE_URL;
}

/**
 * True when the URL points at a shared OSM tile server.
 *
 * The placeholders are substituted before parsing because `new URL` rejects a
 * bare `{z}` in a path, and a provider URL is exactly the shape that arrives
 * here. A URL that still will not parse is not OSM's, and saying so is safer
 * than throwing inside the map's render.
 */
export function isPublicOsmTiles(url: string): boolean {
  const filled = url.replace("{z}", "0").replace("{x}", "0").replace("{y}", "0");
  try {
    const host = new URL(filled).hostname.toLowerCase();
    return host === "openstreetmap.org" || host.endsWith(".openstreetmap.org");
  } catch {
    return false;
  }
}

/**
 * A one-line warning to print in production when the build still points at OSM's
 * public server, or null when there is nothing to say.
 *
 * Deliberately not an error. The operator gets a loud line in the console and
 * the README says what to set; a parent still gets a map.
 */
export function mapTileNotice(configured: string | undefined, isProduction: boolean): string | null {
  if (!isProduction) return null;
  if (!isPublicOsmTiles(resolveMapTileUrl(configured))) return null;
  return (
    "[busguard] Map tiles are still on OpenStreetMap's public server. Set " +
    "NEXT_PUBLIC_MAP_TILE_URL to your own tile provider — OSM forbids production " +
    "traffic and will throttle or block this map."
  );
}
