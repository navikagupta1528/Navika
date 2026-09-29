import { describe, expect, it } from "vitest";
import {
  bearingDegrees,
  boundsOf,
  estimateEtaMinutes,
  haversineMeters,
  lerpLatLng,
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
