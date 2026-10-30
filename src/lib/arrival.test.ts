import { describe, expect, it } from "vitest";
import {
  approachFraction,
  formatCountdown,
  readArrival,
  type ArrivalFix,
  type ArrivalStop,
} from "./arrival";
import { APPROACHING_METERS } from "./geofence";

const STOP: ArrivalStop = { name: "Aundh IT Park", lat: 18.5308, lng: 73.8477 };

/** A fix `meters` due north of the stop, taken `ageMs` before `NOW`. */
const NOW = Date.parse("2026-10-15T08:00:00.000Z");

function fixNorthOf(meters: number, ageMs = 0): ArrivalFix {
  return {
    lat: STOP!.lat + meters / 111_132,
    lng: STOP!.lng,
    at: NOW - ageMs,
  };
}

describe("readArrival", () => {
  it("has nothing to say with no stop and no server figure", () => {
    expect(
      readArrival({ fix: null, stop: null, now: NOW, initialEtaMinutes: null }),
    ).toEqual({ kind: "none" });
  });

  it("falls back to the server figure when no socket fix has arrived yet", () => {
    // The page was opened a beat before the next ping. Showing a dash here would
    // flash an empty countdown on every load.
    const reading = readArrival({
      fix: null,
      stop: STOP,
      now: NOW,
      initialEtaMinutes: 7,
    });
    expect(reading).toMatchObject({ kind: "live", seconds: 7 * 60 });
  });

  it("uses the server figure when the viewer is an admin with no stop", () => {
    const reading = readArrival({
      fix: fixNorthOf(500),
      stop: null,
      now: NOW,
      initialEtaMinutes: 4,
    });
    expect(reading).toMatchObject({ kind: "live", seconds: 4 * 60 });
  });

  it("counts down from a fresh fix", () => {
    const reading = readArrival({
      fix: fixNorthOf(500, 0),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: 99,
    });

    expect(reading.kind).toBe("live");
    if (reading.kind !== "live") return;
    expect(reading.seconds).toBeGreaterThan(0);
    // The live fix must win over the server's stale figure.
    expect(reading.seconds).not.toBe(99 * 60);
    expect(reading.distanceMeters).toBeGreaterThan(480);
    expect(reading.distanceMeters).toBeLessThan(520);
  });

  it("decays the estimate by the age of the fix", () => {
    // Two fixes the same distance out, one newer. The older one must read lower,
    // because the bus has had longer to close the gap — this is what stops the
    // number freezing between pings.
    const fresh = readArrival({
      fix: fixNorthOf(600, 0),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
    });
    const old = readArrival({
      fix: fixNorthOf(600, 10_000),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
    });

    expect(fresh.kind).toBe("live");
    expect(old.kind).toBe("live");
    if (fresh.kind !== "live" || old.kind !== "live") return;
    expect(old.seconds).toBeCloseTo(fresh.seconds - 10, 0);
  });

  it("will not count past zero however old the fix is", () => {
    // A bus standing on its stop for a while, still pinging. The floor is zero,
    // never a negative that would format as "-2 min".
    const reading = readArrival({
      fix: fixNorthOf(5, 110_000),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
    });

    expect(reading.kind).toBe("live");
    if (reading.kind !== "live") return;
    expect(reading.seconds).toBe(0);
  });

  it("holds rather than guesses once the fix goes stale", () => {
    const reading = readArrival({
      fix: fixNorthOf(500, 3 * 60 * 1000),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
    });

    expect(reading.kind).toBe("stale");
    if (reading.kind !== "stale") return;
    // The distance is still reported — it is real, from a real fix. Only the
    // countdown is withheld.
    expect(reading.distanceMeters).toBeGreaterThan(480);
  });

  it("treats the boundary between live and stale as exclusive", () => {
    const stillLive = readArrival({
      fix: fixNorthOf(500, 120_000),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
    });
    const justStale = readArrival({
      fix: fixNorthOf(500, 120_001),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
    });

    expect(stillLive.kind).toBe("live");
    expect(justStale.kind).toBe("stale");
  });

  it("honours an explicit staleness window", () => {
    const reading = readArrival({
      fix: fixNorthOf(500, 5_000),
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
      staleAfterMs: 2_000,
    });
    expect(reading.kind).toBe("stale");
  });

  it("ignores a future fix's negative age", () => {
    // A phone whose clock is ahead sends `at` in the future. Clamping the age at
    // zero means the estimate is not silently *inflated* by the skew.
    const reading = readArrival({
      fix: { ...fixNorthOf(500, 0), at: NOW + 30_000 },
      stop: STOP,
      now: NOW,
      initialEtaMinutes: null,
    });

    expect(reading.kind).toBe("live");
    if (reading.kind !== "live") return;
    expect(reading.seconds).toBeGreaterThan(0);
  });
});

describe("approachFraction", () => {
  it("is empty with no distance to show", () => {
    expect(approachFraction(null)).toBe(0);
  });

  it("is empty at and beyond the outer ring", () => {
    expect(approachFraction(APPROACHING_METERS)).toBe(0);
    expect(approachFraction(APPROACHING_METERS * 2)).toBe(0);
  });

  it("is full at the stop", () => {
    expect(approachFraction(0)).toBe(1);
  });

  it("does not overflow past the stop", () => {
    // A bus that has overshot must show a full bar, not one past the end.
    expect(approachFraction(-300)).toBe(1);
  });

  it("is half way at half the approach distance", () => {
    expect(approachFraction(APPROACHING_METERS / 2)).toBeCloseTo(0.5, 5);
  });
});

describe("formatCountdown", () => {
  it("says 'now' in the last ten seconds", () => {
    expect(formatCountdown(0)).toEqual({ value: "now", unit: "", tone: "here" });
    expect(formatCountdown(10)).toEqual({ value: "now", unit: "", tone: "here" });
  });

  it("shows whole seconds under a minute", () => {
    expect(formatCountdown(45)).toEqual({ value: "45", unit: "sec", tone: "near" });
  });

  it("shows minutes and seconds under two minutes", () => {
    // Ninety seconds is the window where the seconds change what a parent does,
    // so they are shown rather than rounded away.
    expect(formatCountdown(100)).toEqual({ value: "1:40", unit: "min", tone: "near" });
  });

  it("rounds up to whole minutes above two", () => {
    // Rounding *up* means a bus `2 min 10 s` away never reads "2 min" and then
    // arrives late relative to what was promised.
    expect(formatCountdown(130)).toEqual({ value: "3", unit: "min", tone: "near" });
    expect(formatCountdown(360)).toEqual({ value: "6", unit: "min", tone: "far" });
  });

  it("calms down once the bus is more than five minutes out", () => {
    expect(formatCountdown(6 * 60).tone).toBe("far");
    expect(formatCountdown(5 * 60).tone).toBe("near");
  });

  it("pads the seconds so the layout does not jump every second", () => {
    expect(formatCountdown(65).value).toBe("1:05");
  });
});
