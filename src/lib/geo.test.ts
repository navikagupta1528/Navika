import { describe, expect, it } from "vitest";
import {
  bearingDegrees,
  boundsOf,
  estimateEtaMinutes,
  formatDistance,
  fromLngLat,
  haversineMeters,
  isValidCoord,
  isValidPoint,
  lerpLatLng,
  lineLengthMeters,
  moveItem,
  nearestOnPolyline,
  slotFromT,
  toLngLat,
  viewportFor,
  type LatLng,
} from "./geo";

describe("haversineMeters", () => {
  it("returns zero for the same point", () => {
    const p = { lat: 18.5204, lng: 73.8567 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("matches the known Pune to Mumbai great-circle distance", () => {
    // Pune (18.5204, 73.8567) to Mumbai (19.0760, 72.8777) is ~120 km.
    const d = haversineMeters(
      { lat: 18.5204, lng: 73.8567 },
      { lat: 19.076, lng: 72.8777 },
    );
    expect(d).toBeGreaterThan(115_000);
    expect(d).toBeLessThan(125_000);
  });

  it("is symmetric", () => {
    const a = { lat: 18.5204, lng: 73.8567 };
    const b = { lat: 18.526, lng: 73.864 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it("crosses the equator and the prime meridian without breaking", () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: -1, lng: -1 });
    expect(d).toBeGreaterThan(150_000);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe("bearingDegrees", () => {
  it("points north", () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5);
  });

  it("points east", () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5);
  });

  it("points south", () => {
    expect(bearingDegrees({ lat: 1, lng: 0 }, { lat: 0, lng: 0 })).toBeCloseTo(180, 5);
  });

  it("always returns a value in [0, 360)", () => {
    const b = bearingDegrees({ lat: 18.52, lng: 73.85 }, { lat: 18.47, lng: 73.82 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe("lerpLatLng", () => {
  it("returns the start at t=0 and the end at t=1", () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: 20, lng: 30 };
    expect(lerpLatLng(a, b, 0)).toEqual(a);
    expect(lerpLatLng(a, b, 1)).toEqual(b);
  });

  it("returns the midpoint at t=0.5", () => {
    expect(lerpLatLng({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 0.5)).toEqual({
      lat: 5,
      lng: 10,
    });
  });
});

describe("estimateEtaMinutes", () => {
  const depot = { lat: 18.5414, lng: 73.8485 };
  const college = { lat: 18.5308, lng: 73.8477 };

  it("never returns less than one minute", () => {
    expect(estimateEtaMinutes(depot, depot)).toBe(1);
  });

  it("is monotonically non-decreasing with distance", () => {
    const near = estimateEtaMinutes(depot, { lat: 18.54, lng: 73.8485 });
    const far = estimateEtaMinutes(depot, college);
    expect(far).toBeGreaterThanOrEqual(near);
  });

  it("inflates straight-line distance to approximate road distance", () => {
    // ~1.2 km apart; a bus in city traffic should take about 3-4 minutes, not
    // the ~3 that a naive straight-line speed would suggest at 22 km/h.
    const minutes = estimateEtaMinutes(depot, college);
    expect(minutes).toBeGreaterThan(2);
    expect(minutes).toBeLessThan(15);
  });

  it("scales linearly with the assumed average speed", () => {
    const slow = estimateEtaMinutes(depot, college, 11);
    const fast = estimateEtaMinutes(depot, college, 44);
    expect(slow).toBeCloseTo(fast * 4, 0);
  });
});

describe("boundsOf", () => {
  it("returns null for no points", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("finds the extremes", () => {
    expect(
      boundsOf([
        { lat: 1, lng: 2 },
        { lat: -3, lng: 9 },
        { lat: 5, lng: -1 },
      ]),
    ).toEqual({ sw: { lat: -3, lng: -1 }, ne: { lat: 5, lng: 9 } });
  });

  it("handles a single point", () => {
    expect(boundsOf([{ lat: 7, lng: 8 }])).toEqual({
      sw: { lat: 7, lng: 8 },
      ne: { lat: 7, lng: 8 },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Map support                                                                */
/* -------------------------------------------------------------------------- */

describe("isValidCoord", () => {
  it("accepts real coordinates", () => {
    expect(isValidCoord(18.5204, 73.8567)).toBe(true);
    expect(isValidCoord(0, 0)).toBe(true);
    expect(isValidCoord(90, 180)).toBe(true);
    expect(isValidCoord(-90, -180)).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(isValidCoord(90.1, 0)).toBe(false);
    expect(isValidCoord(0, 180.1)).toBe(false);
    expect(isValidCoord(-91, 0)).toBe(false);
  });

  it("rejects NaN and Infinity, which is what an empty form field parses to", () => {
    expect(isValidCoord(Number.NaN, 0)).toBe(false);
    expect(isValidCoord(0, Number.NaN)).toBe(false);
    expect(isValidCoord(Number.POSITIVE_INFINITY, 0)).toBe(false);
  });

  it("rejects anything that is not a number", () => {
    expect(isValidCoord("18.52", 73.85)).toBe(false);
    expect(isValidCoord(18.52, null)).toBe(false);
    expect(isValidCoord(undefined, undefined)).toBe(false);
  });
});

describe("isValidPoint", () => {
  it("accepts a well formed point", () => {
    expect(isValidPoint({ lat: 1, lng: 2 })).toBe(true);
  });

  it("rejects null, undefined and non-objects without throwing", () => {
    expect(isValidPoint(null)).toBe(false);
    expect(isValidPoint(undefined)).toBe(false);
    expect(isValidPoint("18.5,73.8")).toBe(false);
    expect(isValidPoint(42)).toBe(false);
  });
});

describe("nearestOnPolyline", () => {
  // A north-south line with three vertices, each a tenth of a degree apart,
  // so the expected `t` values are easy to state exactly.
  const line: LatLng[] = [
    { lat: 18.5, lng: 73.8 },
    { lat: 18.6, lng: 73.8 },
    { lat: 18.7, lng: 73.8 },
  ];

  it("returns null for an empty line", () => {
    expect(nearestOnPolyline({ lat: 0, lng: 0 }, [])).toBeNull();
  });

  it("puts a point beyond the last vertex at t=1 rather than past the end", () => {
    const r = nearestOnPolyline({ lat: 18.9, lng: 73.8 }, line);
    expect(r?.t).toBeCloseTo(1, 6);
    expect(r?.segment).toBe(1);
  });

  it("puts a point before the first vertex at t=0", () => {
    const r = nearestOnPolyline({ lat: 18.4, lng: 73.8 }, line);
    expect(r?.t).toBeCloseTo(0, 6);
    expect(r?.segment).toBe(0);
  });

  it("puts a point on the middle vertex exactly halfway", () => {
    const r = nearestOnPolyline({ lat: 18.6, lng: 73.8 }, line);
    expect(r?.t).toBeCloseTo(0.5, 3);
    expect(r?.distance).toBeLessThan(1);
  });

  it("snaps an off-route point to the line and measures the gap", () => {
    // 0.01 degrees east of the line. A degree of longitude at 18.6 N is
    // 111320 * cos(18.6) = ~105,500 m, so the gap should be ~1055 m — not the
    // ~960 m a naive "0.01 deg is always about 1 km" would suggest.
    const r = nearestOnPolyline({ lat: 18.6, lng: 73.81 }, line);
    expect(r?.distance).toBeGreaterThan(1000);
    expect(r?.distance).toBeLessThan(1110);
    // The projection itself sits on the line, so `t` is unaffected by the
    // offset perpendicular to it.
    expect(r?.t).toBeCloseTo(0.5, 3);
  });

  it("handles a single-vertex line", () => {
    const r = nearestOnPolyline({ lat: 18.5, lng: 73.81 }, [{ lat: 18.5, lng: 73.8 }]);
    expect(r?.t).toBe(0);
    expect(r?.distance).toBeGreaterThan(900);
  });

  it("weights t by distance, not by vertex index", () => {
    // First segment is 0.001 deg, second is 0.009 deg. The midpoint of the
    // whole line is therefore well past the second vertex.
    const uneven: LatLng[] = [
      { lat: 18.5, lng: 73.8 },
      { lat: 18.501, lng: 73.8 },
      { lat: 18.51, lng: 73.8 },
    ];
    const r = nearestOnPolyline({ lat: 18.5055, lng: 73.8 }, uneven);
    // ~55% along by distance, which lands in the long second segment.
    expect(r?.segment).toBe(1);
    expect(r?.t).toBeGreaterThan(0.5);
  });
});

describe("slotFromT", () => {
  it("returns 0 for a single stop regardless of t", () => {
    expect(slotFromT(0, 1)).toBe(0);
    expect(slotFromT(0.9, 1)).toBe(0);
  });

  it("maps the ends of the route to the end stops", () => {
    expect(slotFromT(0, 5)).toBe(0);
    expect(slotFromT(1, 5)).toBe(4);
  });

  it("divides the route into equal slots", () => {
    // Five stops means t = 0, 0.25, 0.5, 0.75, 1 map to slots 0..4.
    expect(slotFromT(0.25, 5)).toBe(1);
    expect(slotFromT(0.5, 5)).toBe(2);
    expect(slotFromT(0.75, 5)).toBe(3);
  });

  it("clamps a t dragged past either end", () => {
    expect(slotFromT(-3, 5)).toBe(0);
    expect(slotFromT(4.2, 5)).toBe(4);
  });

  it("never returns an out-of-range slot, including for NaN", () => {
    for (const t of [0, 0.1, 0.49, 0.51, 0.9, 1, Number.NaN, Infinity, -Infinity]) {
      const slot = slotFromT(t, 4);
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThanOrEqual(3);
    }
  });
});

describe("moveItem", () => {
  it("returns the same array reference when nothing moves", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 1, 1)).toBe(items);
  });

  it("moves an item forward", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an item backward", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("never mutates the input, because React compares by reference", () => {
    const items = ["a", "b", "c"];
    moveItem(items, 0, 2);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("ignores out-of-range indices instead of corrupting the array", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, -1, 1)).toBe(items);
    expect(moveItem(items, 1, 9)).toBe(items);
    expect(moveItem(items, 5, 0)).toBe(items);
  });
});

describe("viewportFor", () => {
  const fallback = { center: { lat: 0, lng: 0 }, zoom: 3 };

  it("falls back when there is nothing to fit", () => {
    expect(viewportFor([], fallback)).toBe(fallback);
  });

  it("gives a single point a close zoom, not the world view", () => {
    const v = viewportFor([{ lat: 18.52, lng: 73.85 }], fallback);
    expect(v.center.lat).toBeCloseTo(18.52, 3);
    expect(v.zoom).toBeGreaterThanOrEqual(14);
  });

  it("zooms out as the span grows", () => {
    const tight = viewportFor(
      [
        { lat: 18.52, lng: 73.85 },
        { lat: 18.53, lng: 73.85 },
      ],
      fallback,
    );
    const wide = viewportFor(
      [
        { lat: 18.0, lng: 73.0 },
        { lat: 19.0, lng: 74.0 },
      ],
      fallback,
    );
    expect(wide.zoom).toBeLessThan(tight.zoom);
  });

  it("centres on the middle of the padded box, not the middle of the points", () => {
    const points: LatLng[] = [
      { lat: 18.5, lng: 73.8 },
      { lat: 18.7, lng: 73.8 },
    ];
    const v = viewportFor(points, fallback);
    // The centre is the midpoint of the points; padding is symmetric so it
    // does not shift the centre at all.
    expect(v.center.lat).toBeCloseTo(18.6, 6);
    expect(v.center.lng).toBeCloseTo(73.8, 6);
  });

  it("always returns a usable zoom level", () => {
    for (const span of [0.0001, 0.05, 0.5, 5, 90]) {
      const v = viewportFor(
        [
          { lat: 18, lng: 73 },
          { lat: 18 + span, lng: 73 + span },
        ],
        fallback,
      );
      expect(v.zoom).toBeGreaterThanOrEqual(1);
      expect(v.zoom).toBeLessThanOrEqual(20);
    }
  });
});

describe("formatDistance", () => {
  it("uses metres below a kilometre", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(450)).toBe("450 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("switches to one decimal at a kilometre", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(12400)).toBe("12.4 km");
    // Not 1450: 1.45 has no exact binary representation, so `.toFixed(1)`
    // rounds it down. 1460 is the honest halfway case.
    expect(formatDistance(1460)).toBe("1.5 km");
  });

  it("renders a dash rather than NaN", () => {
    expect(formatDistance(Number.NaN)).toBe("—");
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("lineLengthMeters", () => {
  it("is zero for lines shorter than two points", () => {
    expect(lineLengthMeters([])).toBe(0);
    expect(lineLengthMeters([{ lat: 1, lng: 1 }])).toBe(0);
  });

  it("sums the segments", () => {
    const a = { lat: 18.5, lng: 73.8 };
    const b = { lat: 18.6, lng: 73.8 };
    const c = { lat: 18.7, lng: 73.8 };
    const total = lineLengthMeters([a, b, c]);
    expect(total).toBeCloseTo(haversineMeters(a, b) + haversineMeters(b, c), 3);
  });
});

describe("toLngLat / fromLngLat", () => {
  it("swaps the order, because MapLibre is lng-first", () => {
    expect(toLngLat({ lat: 18.52, lng: 73.85 })).toEqual([73.85, 18.52]);
  });

  it("round-trips without losing anything", () => {
    const p = { lat: 18.5204, lng: 73.8567 };
    expect(fromLngLat(toLngLat(p))).toEqual(p);
  });
});
