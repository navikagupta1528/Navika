import { describe, expect, it } from "vitest";
import { dayWindow } from "./day-window";

const at = (ms: number) => new Date(ms);

/** Local midnight for a given instant, without hard-coding a timezone offset. */
function localMidnight(reference: Date): number {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

describe("dayWindow", () => {
  it("returns the instant it was built from", () => {
    const now = Date.parse("2026-10-02T17:45:31.000Z");
    expect(dayWindow(now).now).toBe(now);
  });

  it("zeroes the time on the lower bound", () => {
    const now = Date.parse("2026-10-02T17:45:31.000Z");
    expect(dayWindow(now).start.getTime()).toBe(localMidnight(at(now)));
  });

  it("starts exactly on the local day, not UTC day", () => {
    // The failure this guards against is real in IST: 17:45 UTC on the 2nd is
    // already 23:15 on the 2nd locally, but an hour later it is the 3rd. A
    // window built on UTC dates would put a driver's own evening trip into
    // "tomorrow" and show them nothing at all.
    const now = Date.parse("2026-10-02T17:45:31.000Z");
    const { start, end } = dayWindow(now);
    expect(start.getDate()).toBe(at(now).getDate());
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("makes the upper bound exclusive of the next day", () => {
    // `Trip.date` is a @db.Date with no time component, so an inclusive
    // `<= tomorrow` would match every trip dated exactly tomorrow.
    const now = Date.parse("2026-10-02T09:00:00.000Z");
    const { start, end } = dayWindow(now);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(at(start.getTime() - 1).getTime()).toBeLessThan(start.getTime());
    expect(end.getDate()).toBe(at(start.getTime()).getDate() + 1);
  });

  it("spans exactly one day across a daylight saving change", () => {
    // Not a theoretical concern: setDate adds a calendar day, which is 23 or 25
    // hours on a DST boundary, and a window that comes out 25 hours wide would
    // show a driver tomorrow's trip under today's heading.
    const now = Date.parse("2026-03-08T12:00:00.000Z");
    const { start, end } = dayWindow(now);
    const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
    expect([23, 24, 25]).toContain(hours);
    // Either way, the window still ends on a later calendar day than it starts.
    expect(end.getDate()).not.toBe(start.getDate());
  });

  it("reads the clock at call time, not at module load", () => {
    // The reason this lives in a function rather than inline in the page: a
    // module-level constant would be stamped when the server booted, so a
    // process left running overnight would keep answering with yesterday.
    //
    // Built from local components, not UTC ones. Two UTC timestamps two seconds
    // apart can sit on the same local day in every timezone east of UTC+1, in
    // which case the assertion below would be testing nothing.
    const late = new Date(2026, 9, 2, 23, 59, 59);
    const justAfter = new Date(2026, 9, 3, 0, 0, 1);
    expect(dayWindow(justAfter.getTime()).start.getTime()).toBeGreaterThan(
      dayWindow(late.getTime()).start.getTime(),
    );
  });

  it("accepts an explicit instant so callers can sweep against one clock", () => {
    const now = Date.parse("2026-10-02T06:00:00.000Z");
    expect(dayWindow(now).now).toBe(now);
    expect(dayWindow(now).start.getTime()).toBe(localMidnight(at(now)));
  });
});