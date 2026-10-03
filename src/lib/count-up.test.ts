import { describe, expect, it } from "vitest";

import {
  COUNT_UP_MS,
  countUpProgress,
  countUpValue,
  shouldAnimateChange,
} from "./count-up";

describe("countUpProgress", () => {
  it("starts at nothing and ends at everything", () => {
    expect(countUpProgress(0)).toBe(0);
    expect(countUpProgress(COUNT_UP_MS)).toBe(1);
  });

  it("is negative-safe, because a clock can jump backwards", () => {
    // An elapsed time before the animation started - which a system clock
    // adjustment can genuinely produce - must not rewind the value.
    expect(countUpProgress(-500)).toBe(0);
  });

  it("clamps past the end instead of overshooting", () => {
    // Rendering 130% of the way would show a number the dashboard never had.
    expect(countUpProgress(COUNT_UP_MS * 10)).toBe(1);
    expect(countUpProgress(Number.POSITIVE_INFINITY)).toBe(1);
    expect(countUpProgress(Number.NaN)).toBe(0);
  });

  it("treats a zero or nonsensical duration as already finished", () => {
    expect(countUpProgress(10, 0)).toBe(1);
    expect(countUpProgress(10, -5)).toBe(1);
    expect(countUpProgress(10, Number.NaN)).toBe(1);
  });

  it("never leaves the unit range", () => {
    for (let t = 0; t <= COUNT_UP_MS; t += 7) {
      const p = countUpProgress(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("rises without ever going backwards", () => {
    let previous = -1;
    for (let t = 0; t <= COUNT_UP_MS; t += 5) {
      const p = countUpProgress(t);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it("covers most of the distance early, then settles", () => {
    // The property that makes the change readable. A linear ramp is still at 25%
    // after a quarter of the time and reads as a stuck number.
    expect(countUpProgress(COUNT_UP_MS * 0.25)).toBeGreaterThan(0.5);
  });
});

describe("countUpValue", () => {
  it("shows the destination at the end and the origin at the start", () => {
    expect(countUpValue(10, 20, 0)).toBe(10);
    expect(countUpValue(10, 20, COUNT_UP_MS)).toBe(20);
  });

  it("interpolates downwards too", () => {
    // Counts go down: a bus finishes a run and leaves the "live" total.
    expect(countUpValue(20, 10, COUNT_UP_MS)).toBe(10);
    const midway = countUpValue(20, 10, COUNT_UP_MS * 0.5);
    expect(midway).toBeGreaterThan(10);
    expect(midway).toBeLessThan(20);
  });

  it("is always a whole number at every instant", () => {
    // "41.7 students" is worse than a number that does not move.
    for (let t = 0; t <= COUNT_UP_MS; t += 11) {
      expect(Number.isInteger(countUpValue(3, 9, t))).toBe(true);
    }
  });

  it("stays between the endpoints at every instant", () => {
    for (let t = 0; t <= COUNT_UP_MS; t += 11) {
      const v = countUpValue(3, 9, t);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it("handles a decrease without dipping below the destination", () => {
    for (let t = 0; t <= COUNT_UP_MS; t += 11) {
      const v = countUpValue(9, 3, t);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it("is a no-op when origin and destination match", () => {
    expect(countUpValue(7, 7, COUNT_UP_MS / 2)).toBe(7);
  });
});

describe("shouldAnimateChange", () => {
  it("animates an ordinary count change", () => {
    expect(shouldAnimateChange(41, 44)).toBe(true);
    expect(shouldAnimateChange(44, 41)).toBe(true);
  });

  it("does not animate a value that did not change", () => {
    // Re-running on every render would flicker on each poll, which teaches
    // people to stop looking at the number at all.
    expect(shouldAnimateChange(12, 12)).toBe(false);
  });

  it("does not animate a non-integer", () => {
    // Interpolating a percentage or a currency amount through integers would
    // round away the part the reader came for.
    expect(shouldAnimateChange(41.5, 44.25)).toBe(false);
    expect(shouldAnimateChange(0.5, 1.5)).toBe(false);
  });

  it("refuses a jump large enough to look like a spinner", () => {
    // 0 to 4,000 is a data correction, not an event.
    expect(shouldAnimateChange(0, 4000)).toBe(false);
    expect(shouldAnimateChange(4000, 0)).toBe(false);
    expect(shouldAnimateChange(0, 999)).toBe(true);
  });

  it("refuses values that are not numbers at all", () => {
    expect(shouldAnimateChange(Number.NaN, 5)).toBe(false);
    expect(shouldAnimateChange(5, Number.NaN)).toBe(false);
    expect(shouldAnimateChange(Number.POSITIVE_INFINITY, 5)).toBe(false);
  });
});