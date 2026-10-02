import { describe, expect, it } from "vitest";
import {
  CLOCK_SKEW_FUTURE_MS,
  CLOCK_SKEW_PAST_MS,
  IMPLAUSIBLE_SPEED_KPH,
  MAX_ACCEPTED_ACCURACY_M,
  STALE_AFTER_MS,
  describeFreshness,
  fixFromPosition,
  freshnessFromAge,
  impliedSpeedKph,
  resolveHeadingDeg,
  shouldAcceptFix,
  type Fix,
} from "./tracking";

const NOW = 1_760_000_000_000;

function fix(overrides: Partial<Fix> = {}): Fix {
  return {
    lat: 18.5204,
    lng: 73.8567,
    accuracyM: 10,
    at: NOW,
    speedKph: null,
    headingDeg: null,
    ...overrides,
  };
}

describe("fixFromPosition", () => {
  it("normalises a browser reading", () => {
    const result = fixFromPosition({
      coords: { latitude: 18.5, longitude: 73.8, accuracy: 12, speed: 10, heading: 90 },
      timestamp: NOW,
    });

    expect(result).toEqual({
      lat: 18.5,
      lng: 73.8,
      accuracyM: 12,
      at: NOW,
      speedKph: 36, // m/s -> km/h
      headingDeg: 90,
    });
  });

  it("rejects coordinates that are not a point", () => {
    expect(fixFromPosition({ coords: { latitude: 999, longitude: 73.8 }, timestamp: NOW })).toBeNull();
    expect(fixFromPosition({ coords: { latitude: NaN, longitude: 73.8 }, timestamp: NOW })).toBeNull();
    expect(fixFromPosition(null)).toBeNull();
    expect(fixFromPosition({ coords: undefined as never, timestamp: NOW })).toBeNull();
  });

  it("turns a missing accuracy into 'unknown' rather than a perfect zero", () => {
    // Chrome reports 0 when it has no estimate. Treating that as excellent
    // would let a garbage fix win every comparison against a real one.
    const result = fixFromPosition({
      coords: { latitude: 18.5, longitude: 73.8, accuracy: 0 },
      timestamp: NOW,
    });
    expect(result?.accuracyM).toBe(0);

    const missing = fixFromPosition({
      coords: { latitude: 18.5, longitude: 73.8 },
      timestamp: NOW,
    });
    expect(missing?.accuracyM).toBe(Number.POSITIVE_INFINITY);
  });

  it("drops non-numeric speed and heading instead of leaking NaN", () => {
    const result = fixFromPosition({
      coords: { latitude: 18.5, longitude: 73.8, speed: NaN, heading: -1 },
      timestamp: NOW,
    });
    expect(result?.speedKph).toBeNull();
    expect(result?.headingDeg).toBeNull();
  });

  it("normalises heading above 360 and rejects negative speed", () => {
    const result = fixFromPosition({
      coords: { latitude: 18.5, longitude: 73.8, speed: -1, heading: 400 },
      timestamp: NOW,
    });
    expect(result?.speedKph).toBeNull();
    expect(result?.headingDeg).toBe(40);
  });
});

describe("impliedSpeedKph", () => {
  it("computes speed between two fixes", () => {
    // ~111 m of longitude at this latitude, over 10 s.
    const speed = impliedSpeedKph(
      fix({ lng: 73.8567, at: NOW }),
      fix({ lng: 73.8577, at: NOW + 10_000 }),
    );
    expect(speed).toBeGreaterThan(30);
    expect(speed).toBeLessThan(50);
  });

  it("returns null rather than Infinity for two fixes in the same millisecond", () => {
    // The divide-by-zero case is why this exists: a parked bus whose GPS
    // re-reports the same timestamp must not be discarded as a teleport.
    expect(impliedSpeedKph(fix({ at: NOW }), fix({ at: NOW }))).toBeNull();
  });

  it("returns null when the timestamps run backwards", () => {
    expect(impliedSpeedKph(fix({ at: NOW }), fix({ at: NOW - 5_000 }))).toBeNull();
  });
});

describe("shouldAcceptFix", () => {
  it("accepts the very first fix regardless of quality", () => {
    // On a cold start in a bad spot a rough position still beats a blank map.
    const verdict = shouldAcceptFix(
      null,
      fix({ accuracyM: MAX_ACCEPTED_ACCURACY_M + 500 }),
      NOW,
    );
    expect(verdict).toEqual({ accept: true });
  });

  it("accepts a normal move", () => {
    const prev = fix({ at: NOW - 5_000 });
    const verdict = shouldAcceptFix(prev, fix({ at: NOW, lng: 73.8570 }), NOW);
    expect(verdict.accept).toBe(true);
  });

  it("rejects a fix replayed from a cache", () => {
    const verdict = shouldAcceptFix(null, fix({ at: NOW - (CLOCK_SKEW_PAST_MS + 1) }), NOW);
    expect(verdict).toEqual({ accept: false, reason: "clock-too-old" });
  });

  it("rejects a fix dated in the future by a broken clock", () => {
    const verdict = shouldAcceptFix(null, fix({ at: NOW + CLOCK_SKEW_FUTURE_MS + 1 }), NOW);
    expect(verdict).toEqual({ accept: false, reason: "clock-in-future" });
  });

  it("accepts a fix slightly ahead of our clock", () => {
    const verdict = shouldAcceptFix(null, fix({ at: NOW + 5_000 }), NOW);
    expect(verdict.accept).toBe(true);
  });

  it("refuses to let a blurry fix replace a sharp one", () => {
    const prev = fix({ accuracyM: 8 });
    const verdict = shouldAcceptFix(
      prev,
      fix({ accuracyM: MAX_ACCEPTED_ACCURACY_M + 1, at: NOW + 3_000 }),
      NOW + 3_000,
    );
    expect(verdict).toEqual({ accept: false, reason: "too-inaccurate" });
  });

  it("lets a sharp fix replace a blurry one, however far away", () => {
    const prev = fix({ accuracyM: 5_000, at: NOW - 10_000 });
    const verdict = shouldAcceptFix(prev, fix({ accuracyM: 5, at: NOW }), NOW);
    expect(verdict.accept).toBe(true);
  });

  it("rejects a teleport but names it as one", () => {
    // Pune to Mumbai in five seconds.
    const prev = fix({ at: NOW - 5_000 });
    const verdict = shouldAcceptFix(prev, fix({ lat: 19.076, lng: 72.8777, at: NOW }), NOW);
    expect(verdict).toEqual({ accept: false, reason: "teleport" });
  });

  it("tolerates a fast bus", () => {
    // 120 km/h is well under the ceiling and must survive: this is exactly the
    // case a naive accuracy-only guard would drop on a highway run.
    const metres = (IMPLAUSIBLE_SPEED_KPH / 3.6) * 5 * 0.5; // half the ceiling, 5 s
    const degLat = metres / 111_320;
    const prev = fix({ lat: 18.5, at: NOW - 5_000 });
    const verdict = shouldAcceptFix(prev, fix({ lat: 18.5 + degLat, at: NOW }), NOW);
    expect(verdict.accept).toBe(true);
  });

  it("cannot reject a stationary bus for having zero speed", () => {
    const prev = fix({ at: NOW - 5_000 });
    const verdict = shouldAcceptFix(prev, fix({ at: NOW }), NOW);
    expect(verdict.accept).toBe(true);
  });
});

describe("resolveHeadingDeg", () => {
  it("prefers the heading the device reports", () => {
    expect(resolveHeadingDeg(null, fix(), 187)).toBe(187);
    expect(resolveHeadingDeg(null, fix(), 400)).toBe(40);
  });

  it("falls back to the bearing between two fixes when heading is null", () => {
    // Due east.
    const prev = fix({ lng: 73.85, at: NOW - 10_000 });
    expect(resolveHeadingDeg(prev, fix({ lng: 73.86 }), null)).toBeCloseTo(90, 0);
  });

  it("keeps the previous orientation for a stationary bus", () => {
    // Two fixes 10 s apart at the same spot: the bearing is pure noise, and
    // spinning the marker to face north would be a lie about the bus.
    const prev = fix({ at: NOW - 10_000 });
    expect(resolveHeadingDeg(prev, fix({ at: NOW }), null)).toBeNull();
  });

  it("has no heading to give on the first fix", () => {
    expect(resolveHeadingDeg(null, fix(), null)).toBeNull();
  });
});

describe("freshnessFromAge", () => {
  it("is 1 for a position that just arrived", () => {
    expect(freshnessFromAge(0)).toBe(1);
    expect(freshnessFromAge(-5_000)).toBe(1);
  });

  it("is 0 once the position is unusable", () => {
    expect(freshnessFromAge(STALE_AFTER_MS)).toBe(0);
    expect(freshnessFromAge(STALE_AFTER_MS * 10)).toBe(0);
  });

  it("decays in between", () => {
    expect(freshnessFromAge(STALE_AFTER_MS / 2)).toBeCloseTo(0.5, 5);
  });

  it("is not fooled by NaN", () => {
    expect(freshnessFromAge(Number.NaN)).toBe(1);
  });
});

describe("describeFreshness", () => {
  it("reads as live for the first fifteen seconds", () => {
    expect(describeFreshness(0).tone).toBe("emerald");
    expect(describeFreshness(14_999).label).toBe("Live");
  });

  it("shows the age in seconds while still current", () => {
    expect(describeFreshness(40_000)).toEqual({
      label: "40s ago",
      tone: "emerald",
      detail: "position is current",
    });
  });

  it("warns in amber once the phone may have lost signal", () => {
    const result = describeFreshness(90_000);
    expect(result.tone).toBe("amber");
    expect(result.label).toBe("2 min ago");
    expect(result.detail).toMatch(/lost signal/);
  });

  it("says plainly when there is nothing recent", () => {
    const result = describeFreshness(STALE_AFTER_MS + 1);
    expect(result.tone).toBe("slate");
    expect(result.label).toBe("No recent signal");
    expect(result.detail).toMatch(/last position/);
  });
});
