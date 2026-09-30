import { describe, expect, it } from "vitest";
import {
  legCacheKey,
  parseCachedGeometry,
  parseOsrm,
  routeCacheKey,
  toOsrmCoords,
} from "./osrm-parse";

/** What a well-formed OSRM reply looks like, trimmed to the fields we read. */
function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    code: "Ok",
    routes: [
      {
        distance: 13268.4321,
        duration: 1349.4,
        geometry: {
          coordinates: [
            [73.8567, 18.5204],
            [73.8501, 18.5311],
          ] as [number, number][],
        },
      },
    ],
    ...overrides,
  };
}

describe("parseOsrm", () => {
  const MAX = 3_000_000;

  it("reads distance, duration and geometry from a good reply", () => {
    const route = parseOsrm(okResponse(), MAX);
    expect(route?.distance).toBeCloseTo(13268.4321, 3);
    expect(route?.duration).toBeCloseTo(1349.4, 3);
    expect(route?.geometry.coordinates).toHaveLength(2);
  });

  it("rejects a non-Ok response instead of throwing", () => {
    expect(parseOsrm({ code: "NoRoute", message: "no route" }, MAX)).toBeNull();
  });

  it("rejects an empty or missing routes array", () => {
    expect(parseOsrm({ code: "Ok", routes: [] }, MAX)).toBeNull();
    expect(parseOsrm({ code: "Ok" }, MAX)).toBeNull();
  });

  it("rejects non-objects without throwing", () => {
    for (const bad of [null, undefined, 42, "Ok", true]) {
      expect(parseOsrm(bad, MAX)).toBeNull();
    }
  });

  it("rejects NaN and Infinity, which arrive as null in JSON and as NaN in memory", () => {
    const nanDistance = okResponse();
    (nanDistance.routes[0] as { distance: number }).distance = Number.NaN;
    expect(parseOsrm(nanDistance, MAX)).toBeNull();

    const infDuration = okResponse();
    (infDuration.routes[0] as { duration: number }).duration = Number.POSITIVE_INFINITY;
    expect(parseOsrm(infDuration, MAX)).toBeNull();
  });

  it("rejects negative distance or duration rather than reporting a negative ETA", () => {
    const negative = okResponse();
    (negative.routes[0] as { distance: number }).distance = -1;
    expect(parseOsrm(negative, MAX)).toBeNull();

    const negativeDuration = okResponse();
    (negativeDuration.routes[0] as { duration: number }).duration = -100;
    expect(parseOsrm(negativeDuration, MAX)).toBeNull();
  });

  it("rejects an implausible distance, which is the signature of a garbled reply", () => {
    // A shifted decimal turns a 13 km city route into a 13,000 km one. The
    // bound is deliberately generous, so anything past it is a unit or parsing
    // bug upstream rather than a real journey.
    const garbled = okResponse();
    (garbled.routes[0] as { distance: number }).distance = 13_268_432;
    expect(parseOsrm(garbled, MAX)).toBeNull();
  });

  it("honours the caller's bound rather than a hardcoded one", () => {
    const route = okResponse();
    (route.routes[0] as { distance: number }).distance = 50_000;
    expect(parseOsrm(route, 1_000)).toBeNull();
    expect(parseOsrm(route, 100_000)).not.toBeNull();
  });

  it("keeps the distance when only the geometry is unusable", () => {
    // Throwing the whole response away here would lose a perfectly good ETA
    // over a malformed drawing.
    const noGeometry = okResponse();
    (noGeometry.routes[0] as { geometry: unknown }).geometry = { coordinates: [] };
    const route = parseOsrm(noGeometry, MAX);
    expect(route).not.toBeNull();
    expect(route!.distance).toBeCloseTo(13268.4321, 3);
    expect(route!.geometry.coordinates).toEqual([]);
  });

  it("keeps the distance when the geometry is not an object at all", () => {
    const garbage = okResponse();
    (garbage.routes[0] as { geometry: unknown }).geometry = "nope";
    expect(parseOsrm(garbage, MAX)?.distance).toBeCloseTo(13268.4321, 3);
  });

  it("returns null when there is no first route, rather than crashing", () => {
    expect(parseOsrm({ code: "Ok", routes: [null] }, MAX)).toBeNull();
  });
});

describe("parseCachedGeometry", () => {
  it("round-trips a normal polyline", () => {
    const pairs: [number, number][] = [
      [73.8567, 18.5204],
      [73.8501, 18.5311],
    ];
    expect(parseCachedGeometry(pairs)).toEqual(pairs);
  });

  it("returns null for SQL NULL, which is what a legacy row holds", () => {
    expect(parseCachedGeometry(null)).toBeNull();
    expect(parseCachedGeometry(undefined)).toBeNull();
  });

  it("returns null for anything that is not an array", () => {
    for (const bad of [42, "[]", {}, true]) {
      expect(parseCachedGeometry(bad)).toBeNull();
    }
  });

  it("returns null for a single point, since a line needs two", () => {
    expect(parseCachedGeometry([[73.8, 18.5]])).toBeNull();
  });

  it("returns null for a pair of the wrong length", () => {
    expect(
      parseCachedGeometry([
        [73.8, 18.5],
        [73.9],
      ]),
    ).toBeNull();
    expect(
      parseCachedGeometry([
        [73.8, 18.5],
        [73.9, 18.6, 19.0],
      ]),
    ).toBeNull();
  });

  it("returns null rather than passing NaN through to a map", () => {
    // An empty form field parses to NaN, and NaN in a coordinate makes MapLibre
    // throw inside the style setter and leave a permanently blank map.
    expect(
      parseCachedGeometry([
        [73.8, 18.5],
        [Number.NaN, 18.6],
      ]),
    ).toBeNull();
  });

  it("rejects out-of-range coordinates rather than trusting the array shape", () => {
    expect(
      parseCachedGeometry([
        [73.8, 18.5],
        [200, 18.6],
      ]),
    ).toBeNull();
    expect(
      parseCachedGeometry([
        [73.8, 18.5],
        [73.9, 91],
      ]),
    ).toBeNull();
  });

  it("rejects stringified numbers, which hand-edited JSON is full of", () => {
    expect(
      parseCachedGeometry([
        [73.8, 18.5],
        ["73.9", "18.6"],
      ]),
    ).toBeNull();
  });

  it("accepts the extremes of the valid range", () => {
    expect(
      parseCachedGeometry([
        [-180, -90],
        [180, 90],
      ]),
    ).toEqual([
      [-180, -90],
      [180, 90],
    ]);
  });

  it("rejects a whole polyline when any one point is bad, never partially", () => {
    // A half-valid polyline draws a line that skips half the route, which is
    // worse than not drawing it.
    expect(
      parseCachedGeometry([
        [73.8, 18.5],
        [73.85, 18.55],
        ["bad", 18.6],
        [73.9, 18.65],
      ]),
    ).toBeNull();
  });
});

describe("routeCacheKey", () => {
  const a = { lat: 18.5204, lng: 73.8567 };
  const b = { lat: 18.5311, lng: 73.8501 };
  const c = { lat: 18.5402, lng: 73.8444 };

  it("is stable for the same points", () => {
    expect(routeCacheKey([a, b, c])).toBe(routeCacheKey([a, b, c]));
  });

  it("differs for a different order, because A-B-C and C-B-A are different journeys", () => {
    expect(routeCacheKey([a, b, c])).not.toBe(routeCacheKey([c, b, a]));
  });

  it("is versioned, so a change to the rounding or format cannot collide with old rows", () => {
    expect(routeCacheKey([a, b])).toMatch(/^route:v1:/);
  });

  it("rounds coordinates, so a bus crawling at a stop reuses one row", () => {
    // 0.00001 degrees is about 1 m, well inside the rounding.
    expect(routeCacheKey([{ lat: 18.520401, lng: 73.856699 }])).toBe(routeCacheKey([a]));
  });

  it("separates routes from legs even for the same pair of points", () => {
    expect(routeCacheKey([a, b])).not.toBe(legCacheKey(a, b));
  });

  it("is direction sensitive, so a reversed leg is a different key", () => {
    expect(legCacheKey(a, b)).not.toBe(legCacheKey(b, a));
  });

  it("handles an empty list without throwing", () => {
    expect(routeCacheKey([])).toBe("route:v1:");
  });
});

describe("toOsrmCoords", () => {
  it("emits longitude first, because OSRM is GeoJSON-ordered", () => {
    // Getting this backwards silently routes through the Gulf of Guinea.
    expect(toOsrmCoords([{ lat: 18.5204, lng: 73.8567 }])).toBe("73.8567,18.5204");
  });

  it("joins multiple points with semicolons", () => {
    expect(
      toOsrmCoords([
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 },
        { lat: 5, lng: 6 },
      ]),
    ).toBe("2,1;4,3;6,5");
  });
});
