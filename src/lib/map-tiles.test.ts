import { describe, expect, it } from "vitest";
import {
  OSM_PUBLIC_TILE_URL,
  isPublicOsmTiles,
  mapTileNotice,
  resolveMapTileUrl,
} from "./map-tiles";

describe("resolveMapTileUrl", () => {
  it("falls back to OSM when unset", () => {
    expect(resolveMapTileUrl(undefined)).toBe(OSM_PUBLIC_TILE_URL);
    expect(resolveMapTileUrl("")).toBe(OSM_PUBLIC_TILE_URL);
    expect(resolveMapTileUrl("   ")).toBe(OSM_PUBLIC_TILE_URL);
  });

  it("uses a configured provider", () => {
    const url = "https://tiles.example.com/{z}/{x}/{y}.png?key=abc";
    expect(resolveMapTileUrl(url)).toBe(url);
  });
});

describe("isPublicOsmTiles", () => {
  it("recognises OSM's subdomains", () => {
    expect(isPublicOsmTiles(OSM_PUBLIC_TILE_URL)).toBe(true);
    expect(isPublicOsmTiles("https://a.tile.openstreetmap.org/{z}/{x}/{y}.png")).toBe(true);
  });

  it("does not flag a private provider", () => {
    expect(isPublicOsmTiles("https://tiles.example.com/{z}/{x}/{y}.png")).toBe(false);
    expect(isPublicOsmTiles("https://my-openstreetmap-clone.internal/tiles/{z}/{x}/{y}.png")).toBe(
      false,
    );
  });

  it("does not throw on a malformed URL", () => {
    expect(isPublicOsmTiles("not a url")).toBe(false);
  });
});

describe("mapTileNotice", () => {
  it("stays quiet in development", () => {
    expect(mapTileNotice(undefined, false)).toBeNull();
  });

  it("stays quiet in production when a provider is configured", () => {
    expect(mapTileNotice("https://tiles.example.com/{z}/{x}/{y}.png", true)).toBeNull();
  });

  it("warns in production when the build is still on OSM", () => {
    expect(mapTileNotice(undefined, true)).toContain("NEXT_PUBLIC_MAP_TILE_URL");
    expect(mapTileNotice(OSM_PUBLIC_TILE_URL, true)).toContain("OpenStreetMap");
  });
});
