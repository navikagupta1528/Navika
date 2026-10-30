import { describe, expect, it } from "vitest";
import {
  DELAY_NOTIFY_THRESHOLD_MINUTES,
  delayMinutesFromSchedule,
  formatDelayPhrase,
  isSignificantDelay,
} from "./delay";

/** A Date at a fixed local time, so the arithmetic is not tied to the run date. */
function at(hours: number, minutes: number, seconds = 0): Date {
  return new Date(2026, 9, 16, hours, minutes, seconds);
}

describe("delayMinutesFromSchedule", () => {
  it("is zero when the bus reaches the stop on time", () => {
    expect(delayMinutesFromSchedule("07:30", at(7, 30))).toBe(0);
  });

  it("is positive when the bus is late", () => {
    expect(delayMinutesFromSchedule("07:30", at(7, 38))).toBe(8);
  });

  it("is negative when the bus is early", () => {
    expect(delayMinutesFromSchedule("07:30", at(7, 25))).toBe(-5);
  });

  it("compares on the same calendar day, so a stop near midnight is not a day off", () => {
    // 23:58 against a 23:50 schedule is eight minutes late, not a day early.
    expect(delayMinutesFromSchedule("23:50", at(23, 58))).toBe(8);
  });

  it("rounds to the nearest minute", () => {
    expect(delayMinutesFromSchedule("07:30", at(7, 30, 30))).toBe(1);
    expect(delayMinutesFromSchedule("07:30", at(7, 30, 29))).toBe(0);
  });

  it("treats an unparseable schedule as no delay rather than throwing", () => {
    // A stop with no scheduled time has nothing to be late against.
    expect(delayMinutesFromSchedule("", at(7, 30))).toBe(0);
    expect(delayMinutesFromSchedule("not-a-time", at(7, 30))).toBe(0);
  });
});

describe("formatDelayPhrase", () => {
  it("says how late the bus is", () => {
    expect(formatDelayPhrase(8)).toBe("8 min late");
    expect(formatDelayPhrase(1)).toBe("1 min late");
  });

  it("says on time rather than '0 min late'", () => {
    expect(formatDelayPhrase(0)).toBe("on time");
  });

  it("says when the bus is early", () => {
    expect(formatDelayPhrase(-3)).toBe("3 min early");
  });
});

describe("isSignificantDelay", () => {
  it("is false below the threshold", () => {
    expect(isSignificantDelay(DELAY_NOTIFY_THRESHOLD_MINUTES - 1)).toBe(false);
  });

  it("is true at the threshold", () => {
    expect(isSignificantDelay(DELAY_NOTIFY_THRESHOLD_MINUTES)).toBe(true);
  });

  it("is true above the threshold", () => {
    expect(isSignificantDelay(DELAY_NOTIFY_THRESHOLD_MINUTES + 10)).toBe(true);
  });

  it("is false for an early bus", () => {
    expect(isSignificantDelay(-5)).toBe(false);
  });
});
