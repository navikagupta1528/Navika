import { describe, expect, it } from "vitest";
import {
  HARD_ACCELERATION_KPH,
  HARSH_BRAKING_KPH,
  MAX_JUDGED_INTERVAL_S,
  OVERSPEED_KPH,
  classifyFix,
  scoreFromEvents,
  scoreTone,
  type DrivingFix,
} from "./driving";

const fix = (speedKph: number, at: number, lat = 18.5, lng = 73.8): DrivingFix => ({
  lat,
  lng,
  speedKph,
  at,
});

/** Two fixes `seconds` apart at the given speeds. */
function pair(prevSpeed: number, nextSpeed: number, seconds = 5): [DrivingFix, DrivingFix] {
  const at = 1_700_000_000_000;
  return [fix(prevSpeed, at), fix(nextSpeed, at + seconds * 1000)];
}

describe("classifyFix", () => {
  it("sees nothing wrong with a steady bus", () => {
    expect(classifyFix(...pair(40, 40))).toEqual([]);
  });

  it("sees nothing in a gentle slowdown", () => {
    // Below the threshold: a normal approach to a stop.
    expect(classifyFix(...pair(40, 40 - (HARSH_BRAKING_KPH - 1)))).toEqual([]);
  });

  it("flags a harsh brake", () => {
    const events = classifyFix(...pair(50, 50 - (HARSH_BRAKING_KPH + 5)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "HARSH_BRAKING" });
  });

  it("flags a hard acceleration", () => {
    const events = classifyFix(...pair(20, 20 + (HARD_ACCELERATION_KPH + 5)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "HARD_ACCELERATION" });
  });

  it("flags overspeed on the speed itself", () => {
    const events = classifyFix(...pair(OVERSPEED_KPH + 10, OVERSPEED_KPH + 12));
    expect(events.some((e) => e.type === "OVERSPEED")).toBe(true);
  });

  it("does not flag a bus at exactly the speed limit", () => {
    expect(classifyFix(...pair(OVERSPEED_KPH, OVERSPEED_KPH))).toEqual([]);
  });

  it("reports a hard brake and an overspeed together when both are true", () => {
    // A driver who brakes hard from a high speed but is still over the limit
    // is doing both, and reporting only the first would hide the second.
    const events = classifyFix(...pair(OVERSPEED_KPH + 20, OVERSPEED_KPH + 5));
    const types = events.map((e) => e.type);
    expect(types).toContain("HARSH_BRAKING");
    expect(types).toContain("OVERSPEED");
  });

  it("ignores a change across a long gap — the phone was off", () => {
    // A 20 km/h change over five minutes is not a braking decision.
    expect(
      classifyFix(...pair(50, 50 - 20, MAX_JUDGED_INTERVAL_S + 60)),
    ).toEqual([]);
  });

  it("ignores a clock that went backwards", () => {
    const at = 1_700_000_000_000;
    expect(classifyFix(fix(50, at), fix(30, at - 1000))).toEqual([]);
  });
});

describe("scoreFromEvents", () => {
  it("gives a clean run 100", () => {
    expect(scoreFromEvents([]).score).toBe(100);
  });

  it("subtracts the penalty for each event", () => {
    // One harsh brake (3) and one overspeed (5) = 8 off.
    const { score, counts } = scoreFromEvents([
      { type: "HARSH_BRAKING", magnitudeKph: 20, at: 0 },
      { type: "OVERSPEED", magnitudeKph: 70, at: 0 },
    ]);
    expect(score).toBe(92);
    expect(counts.HARSH_BRAKING).toBe(1);
    expect(counts.OVERSPEED).toBe(1);
  });

  it("clamps at zero rather than going negative", () => {
    const events = Array.from({ length: 30 }, () => ({
      type: "OVERSPEED" as const,
      magnitudeKph: 70,
      at: 0,
    }));
    expect(scoreFromEvents(events).score).toBe(0);
  });

  it("counts every event type", () => {
    const { counts, total } = scoreFromEvents([
      { type: "HARSH_BRAKING", magnitudeKph: 20, at: 0 },
      { type: "HARD_ACCELERATION", magnitudeKph: 15, at: 0 },
      { type: "OVERSPEED", magnitudeKph: 70, at: 0 },
    ]);
    expect(counts.HARSH_BRAKING).toBe(1);
    expect(counts.HARD_ACCELERATION).toBe(1);
    expect(counts.OVERSPEED).toBe(1);
    expect(total).toBe(3);
  });
});

describe("scoreTone", () => {
  it("calls a good score good", () => {
    expect(scoreTone(100).tone).toBe("good");
    expect(scoreTone(80).tone).toBe("good");
  });

  it("calls a middling score fair", () => {
    expect(scoreTone(79).tone).toBe("fair");
    expect(scoreTone(60).tone).toBe("fair");
  });

  it("calls a poor score needs coaching", () => {
    expect(scoreTone(59).tone).toBe("poor");
    expect(scoreTone(0).tone).toBe("poor");
  });
});
