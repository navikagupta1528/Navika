import { describe, expect, it } from "vitest";
import { summariseAttendance, type AttendanceRow } from "./attendance-summary";

const row = (
  date: string,
  status: AttendanceRow["status"],
  extra: Partial<AttendanceRow> = {},
): AttendanceRow => ({ date, direction: "PICKUP", status, ...extra });

describe("summariseAttendance", () => {
  it("counts every status", () => {
    const s = summariseAttendance([
      row("2026-03-01", "PICKED"),
      row("2026-03-02", "PICKED"),
      row("2026-03-03", "MISSED"),
      row("2026-03-04", "ABSENT"),
      row("2026-03-05", "WAITING"),
      row("2026-03-06", "PENDING"),
    ]);

    expect(s.total).toBe(6);
    expect(s.picked).toBe(2);
    expect(s.missed).toBe(1);
    expect(s.absent).toBe(1);
    expect(s.waiting).toBe(1);
    expect(s.pending).toBe(1);
  });

  describe("pick rate", () => {
    it("is picked over settled, excluding unresolved rows", () => {
      // PENDING and WAITING are not settled, so counting them in the denominator
      // would make a child look worse for a trip that has not happened yet.
      const s = summariseAttendance([
        row("2026-03-01", "PICKED"),
        row("2026-03-02", "PICKED"),
        row("2026-03-03", "PICKED"),
        row("2026-03-04", "MISSED"),
        row("2026-03-05", "PENDING"),
      ]);
      expect(s.pickRate).toBe(75);
    });

    it("is null with no settled rows, rather than 0", () => {
      // "0%" for a child with no trips reads as a failing grade in a parent-facing
      // screen. The honest answer is "nothing to report".
      expect(summariseAttendance([]).pickRate).toBeNull();
      expect(summariseAttendance([row("2026-03-01", "PENDING")]).pickRate).toBeNull();
    });

    it("is 100 when every settled trip was a pickup", () => {
      const s = summariseAttendance([row("2026-03-01", "PICKED"), row("2026-03-02", "PICKED")]);
      expect(s.pickRate).toBe(100);
    });

    it("rounds rather than truncating", () => {
      // 2/3 is 66.67%. Truncating to 66 would understate every rate in the app.
      const s = summariseAttendance([
        row("2026-03-01", "PICKED"),
        row("2026-03-02", "PICKED"),
        row("2026-03-03", "MISSED"),
      ]);
      expect(s.pickRate).toBe(67);
    });
  });

  describe("gaps", () => {
    it("is zero when the most recent trip was a pickup", () => {
      const s = summariseAttendance([
        row("2026-03-10", "PICKED"),
        row("2026-03-09", "MISSED"),
        row("2026-03-08", "MISSED"),
      ]);
      expect(s.sinceLastPickup).toBe(0);
      // But the historical run is still worth reporting.
      expect(s.longestGap).toBe(2);
    });

    it("counts consecutive trips at the end", () => {
      const s = summariseAttendance([
        row("2026-03-10", "MISSED"),
        row("2026-03-09", "ABSENT"),
        row("2026-03-08", "PICKED"),
      ]);
      expect(s.sinceLastPickup).toBe(2);
      expect(s.longestGap).toBe(2);
    });

    it("counts WAITING as a gap", () => {
      // "Marked waiting, bus left" is not the same failure as "never came", but
      // from the parent's side both mean the child did not get on.
      const s = summariseAttendance([
        row("2026-03-10", "WAITING"),
        row("2026-03-09", "PICKED"),
      ]);
      expect(s.sinceLastPickup).toBe(1);
    });

    it("does not break a streak over a day with no trip", () => {
      // The point of counting trips rather than days: a Sunday has no rows, and a
      // day-based streak would report an unbroken run of misses across a weekend
      // in which the bus was not running. Wrong, and alarming to a parent.
      const s = summariseAttendance([
        row("2026-03-10", "MISSED"),
        // 8th and 9th were a Sunday and a Monday - the bus does not run.
        row("2026-03-07", "MISSED"),
        row("2026-03-06", "PICKED"),
      ]);
      expect(s.sinceLastPickup).toBe(2);
      expect(s.longestGap).toBe(2);
    });

    it("finds the longest run anywhere, not just the trailing one", () => {
      const s = summariseAttendance([
        row("2026-03-10", "PICKED"),
        row("2026-03-09", "MISSED"),
        row("2026-03-08", "PICKED"),
        row("2026-03-07", "MISSED"),
        row("2026-03-06", "MISSED"),
        row("2026-03-05", "MISSED"),
        row("2026-03-04", "PICKED"),
      ]);
      expect(s.sinceLastPickup).toBe(0);
      expect(s.longestGap).toBe(3);
    });

    it("sorts its own input rather than trusting the caller's order", () => {
      // The caller gets rows in whatever order the database returned. If this
      // walked the array as given, an ascending query would report a child who
      // was picked up this morning as never picked up at all.
      const ascending = summariseAttendance([
        row("2026-03-08", "MISSED"),
        row("2026-03-09", "MISSED"),
        row("2026-03-10", "PICKED"),
      ]);
      expect(ascending.sinceLastPickup).toBe(0);
      expect(ascending.longestGap).toBe(2);
    });

    it("counts a child who has never been picked up", () => {
      const s = summariseAttendance([row("2026-03-10", "MISSED"), row("2026-03-09", "MISSED")]);
      expect(s.sinceLastPickup).toBe(2);
      expect(s.longestGap).toBe(2);
    });

    it("is zero for an empty history", () => {
      const s = summariseAttendance([]);
      expect(s.sinceLastPickup).toBe(0);
      expect(s.longestGap).toBe(0);
      expect(s.total).toBe(0);
      expect(s.mostTripsOn).toBeNull();
    });
  });

  describe("busiest day", () => {
    it("finds the day with the most trips", () => {
      const s = summariseAttendance([
        row("2026-03-01", "PICKED"),
        row("2026-03-02", "PICKED"),
        row("2026-03-02", "MISSED"),
        row("2026-03-03", "PICKED"),
      ]);
      expect(s.mostTripsOn).toEqual({ date: "2026-03-02", count: 2 });
    });

    it("is null with no history", () => {
      expect(summariseAttendance([]).mostTripsOn).toBeNull();
    });
  });

  describe("stops", () => {
    it("counts the distinct stops used", () => {
      const s = summariseAttendance([
        row("2026-03-01", "PICKED", { stop: "Gate 1" }),
        row("2026-03-02", "PICKED", { stop: "Gate 2" }),
        row("2026-03-03", "PICKED", { stop: "Gate 1" }),
      ]);
      expect(s.stopsUsed).toBe(2);
    });

    it("ignores rows with no stop rather than counting them as one", () => {
      // A caller that does not care about stops should get 0, not 1.
      const s = summariseAttendance([row("2026-03-01", "PICKED")]);
      expect(s.stopsUsed).toBe(0);
    });
  });

  it("does not mutate the array it was given", () => {
    // `gaps` sorts, and sorting in place would reorder a list already rendered
    // elsewhere on the page.
    const rows = [row("2026-03-08", "PICKED"), row("2026-03-10", "MISSED")];
    const copy = [...rows];
    summariseAttendance(rows);
    expect(rows).toEqual(copy);
  });
});