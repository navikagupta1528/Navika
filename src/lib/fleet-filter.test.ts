import { describe, expect, it } from "vitest";
import { describeBus, hasPosition, isReportable, type ReportableBus } from "./fleet-filter";
import { STALE_AFTER_MS } from "./tracking";
// The display window lives in utils, matching the module under test. Importing
// it from tracking yields `undefined`, and every `NOW - undefined` below is
// NaN, which would make the boundary tests fail for the wrong reason.
import { LIVE_WINDOW_MS } from "./utils";

const NOW = 1_760_000_000_000;

function bus(overrides: Partial<ReportableBus> = {}): ReportableBus {
  return {
    currentLat: 18.52,
    currentLng: 73.85,
    lastLocationAt: new Date(NOW - 30_000),
    ...overrides,
  };
}

describe("isReportable", () => {
  it("includes a bus that reported just now", () => {
    expect(isReportable(bus(), NOW)).toBe(true);
  });

  it("includes a bus right at the window edge", () => {
    const edge = bus({ lastLocationAt: new Date(NOW - LIVE_WINDOW_MS) });
    expect(isReportable(edge, NOW)).toBe(true);
  });

  it("excludes a bus that has gone quiet past the window", () => {
    const late = bus({ lastLocationAt: new Date(NOW - LIVE_WINDOW_MS - 1) });
    expect(isReportable(late, NOW)).toBe(false);
  });

  it("excludes a bus with a timestamp but no coordinates", () => {
    expect(isReportable(bus({ currentLat: null }), NOW)).toBe(false);
    expect(isReportable(bus({ currentLng: null }), NOW)).toBe(false);
  });

  it("excludes a bus that has never reported", () => {
    expect(isReportable(bus({ lastLocationAt: null }), NOW)).toBe(false);
  });

  it("excludes a placeholder timestamp at the epoch", () => {
    // A bus seeded with `new Date(0)` renders as a dot on the coast of Africa
    // and reads as a position, which is worse than showing nothing.
    expect(isReportable(bus({ lastLocationAt: new Date(0) }), NOW)).toBe(false);
  });

  it("excludes an invalid date", () => {
    expect(isReportable(bus({ lastLocationAt: new Date("nonsense") }), NOW)).toBe(false);
  });
});

describe("hasPosition", () => {
  it("narrows a complete pair", () => {
    const value = bus();
    expect(hasPosition(value)).toBe(true);
    if (hasPosition(value)) {
      // Type-level assertion: inside the guard these are `number`, not
      // `number | null`. The arithmetic is only here to prove they are usable.
      expect(value.currentLat + value.currentLng).toBeCloseTo(92.37, 2);
    }
  });

  it("rejects NaN coordinates that Prisma can hand back from a float column", () => {
    expect(hasPosition(bus({ currentLat: Number.NaN }))).toBe(false);
  });
});

describe("describeBus", () => {
  it("returns null for a bus that must not be shown", () => {
    expect(describeBus(bus({ lastLocationAt: new Date(NOW - 10 * 60_000) }), NOW)).toBeNull();
  });

  it("calls a recent fix live", () => {
    expect(describeBus(bus(), NOW)?.live).toBe(true);
  });

  /**
   * `STALE_AFTER_MS` and `LIVE_WINDOW_MS` are both two minutes, so "still shown
   * on the map" and "still called live" share one boundary. Pinned here because
   * if these ever diverge, the bus stays on screen with a freshness of zero and
   * the map claims to show a bus it has already given up on.
   */
  it("stops calling it live at the same moment it stops being shown", () => {
    const atBoundary = bus({ lastLocationAt: new Date(NOW - STALE_AFTER_MS) });
    // Still on screen at exactly the window edge, and no longer live. One
    // millisecond later it disappears entirely.
    expect(describeBus(atBoundary, NOW)).toEqual({
      label: "No recent signal",
      live: false,
      freshness: 0,
    });
    expect(describeBus(bus({ lastLocationAt: new Date(NOW - LIVE_WINDOW_MS - 1) }), NOW)).toBeNull();
  });

  it("decays the freshness the marker ring is drawn from", () => {
    // 30 s old against a 120 s window: 1 - 30/120.
    expect(describeBus(bus(), NOW)?.freshness).toBeCloseTo(0.75, 5);
    const aged = bus({ lastLocationAt: new Date(NOW - LIVE_WINDOW_MS / 2) });
    expect(describeBus(aged, NOW)?.freshness).toBeCloseTo(0.5, 5);
  });

  it("reports the age in words", () => {
    expect(describeBus(bus(), NOW)?.label).toBe("30s ago");
    expect(describeBus(bus({ lastLocationAt: new Date(NOW - 5_000) }), NOW)?.label).toBe("Live");
  });
});
