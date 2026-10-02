import { describe, expect, it } from "vitest";
import { dateWindow, MAX_EXPORT_DAYS, validateRange } from "./export-range";

describe("validateRange", () => {
  it("accepts a normal inclusive range", () => {
    const out = validateRange("2026-01-01", "2026-03-31");
    expect(out).toEqual({ ok: true, from: "2026-01-01", to: "2026-03-31" });
  });

  it("accepts a single day", () => {
    // from === to is one day, not zero, and not an error.
    expect(validateRange("2026-03-31", "2026-03-31").ok).toBe(true);
  });

  it("accepts exactly the maximum window", () => {
    const to = new Date(Date.UTC(2026, 0, 1 + MAX_EXPORT_DAYS - 1));
    const iso = to.toISOString().slice(0, 10);
    expect(validateRange("2026-01-01", iso).ok).toBe(true);
  });

  it("rejects one day past the maximum", () => {
    const to = new Date(Date.UTC(2026, 0, 1 + MAX_EXPORT_DAYS));
    const iso = to.toISOString().slice(0, 10);
    const out = validateRange("2026-01-01", iso);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain(String(MAX_EXPORT_DAYS));
  });

  describe("rejects a range that is not a real date window", () => {
    // Each of these, if it slipped through, would export the whole table. A
    // failed parse that defaulted to "all time" is the failure mode that matters.
    const bad: [string | null, string | null, string][] = [
      [null, "2026-03-31", "missing start"],
      ["2026-01-01", null, "missing end"],
      [null, null, "both missing"],
      ["", "2026-03-31", "empty start"],
      ["abc", "2026-03-31", "not a date at all"],
      ["2026-1-1", "2026-03-31", "unpadded, which a browser form gives"],
      ["01/01/2026", "03/31/2026", "US format"],
      ["2026-01-01T00:00:00Z", "2026-03-31", "a full timestamp"],
      ["2026-01-01 ", "2026-03-31", "trailing whitespace"],
      [" 2026-01-01", "2026-03-31", "leading whitespace"],
      ["2026-01-01", "2026-01-01; DROP TABLE PickupRecord", "injection attempt"],
      ["2026-13-01", "2026-13-02", "month 13"],
      ["2026-00-01", "2026-01-02", "month 0"],
      ["2026-02-31", "2026-03-01", "February the 31st"],
      ["2026-04-31", "2026-05-01", "April the 31st"],
      ["2026-01-32", "2026-02-01", "day 32"],
      ["2026-01-00", "2026-02-01", "day 0"],
      ["2026-03-31", "2026-01-01", "reversed"],
      ["2026-03-31", "2026-03-30", "reversed by one day"],
    ];

    for (const [from, to, label] of bad) {
      it(`refuses ${label}`, () => {
        const out = validateRange(from, to);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.error.length).toBeGreaterThan(0);
      });
    }
  });

  it("accepts a leap day that really is one", () => {
    expect(validateRange("2028-02-29", "2028-02-29").ok).toBe(true);
  });

  it("refuses February 29th in a common year", () => {
    // The check is a round trip of the constructed date, so 2027-02-29 builds
    // 1 March 2027 and fails the comparison. A bare month-length check would
    // either special-case the century rule wrongly or miss this entirely.
    expect(validateRange("2027-02-28", "2027-02-29").ok).toBe(false);
  });
});

describe("dateWindow", () => {
  it("starts at local midnight on the start day", () => {
    const { gte } = dateWindow("2026-03-01", "2026-03-31");
    expect(gte.getFullYear()).toBe(2026);
    expect(gte.getMonth()).toBe(2);
    expect(gte.getDate()).toBe(1);
    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);
  });

  it("ends at the start of the day AFTER the end day, exclusively", () => {
    // This is the bug that makes "everything through the 1st" come back empty
    // for the 1st: an inclusive-looking `new Date(to)` covers only that instant.
    const { lt } = dateWindow("2026-03-01", "2026-03-01");
    expect(lt.getDate()).toBe(2);
    expect(lt.getHours()).toBe(0);
  });

  it("covers every day in a range, not one day fewer", () => {
    const { gte, lt } = dateWindow("2026-03-01", "2026-03-31");
    const days = Math.round((lt.getTime() - gte.getTime()) / 86_400_000);
    expect(days).toBe(31);
  });

  it("uses local time, not UTC", () => {
    // Trip.date is a local calendar date. A UTC boundary would push any trip
    // east of Greenwich into the next day and drop it out of its own export.
    //
    // Asserted as "same as the local Date constructor" rather than as a fixed
    // offset, because the offset depends on where the test runs. An earlier
    // version of this test asserted the two agreed, which held only in UTC and
    // failed on any machine in IST - correctly, but for the wrong reason.
    const { gte, lt } = dateWindow("2026-03-01", "2026-03-01");
    expect(gte.getTime()).toBe(new Date(2026, 2, 1).getTime());
    expect(lt.getTime()).toBe(new Date(2026, 2, 2).getTime());

    // And the difference from a UTC-built boundary is what makes the choice
    // matter: in any zone east of or west of UTC these disagree.
    expect(gte.getTime()).not.toBe(Date.UTC(2026, 2, 1));
  });

  it("rolls the month boundary correctly", () => {
    const { lt } = dateWindow("2026-03-15", "2026-03-31");
    expect(lt.getMonth()).toBe(3);
    expect(lt.getDate()).toBe(1);
  });

  it("rolls the year boundary correctly", () => {
    const { lt } = dateWindow("2026-12-20", "2026-12-31");
    expect(lt.getFullYear()).toBe(2027);
    expect(lt.getMonth()).toBe(0);
    expect(lt.getDate()).toBe(1);
  });
});