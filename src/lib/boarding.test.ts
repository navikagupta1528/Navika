import { describe, expect, it } from "vitest";
import {
  ARRIVING_METERS,
  DEPARTED_METERS,
  departureOutcome,
  isSafetyCritical,
  newlyDeparted,
  type BoardingStop,
} from "./boarding";
import type { LatLng } from "./geo";

const STOP: BoardingStop = { id: "stop-1", name: "Aundh IT Park", lat: 18.5308, lng: 73.8477 };

/** A point `meters` due north of the stop. Same single-axis trick as `geofence.test.ts`. */
function northOf(stop: BoardingStop, meters: number): LatLng {
  return { lat: stop.lat + meters / 111_132, lng: stop.lng };
}

const baseInput = {
  stops: [STOP],
  arrived: new Set<string>(["stop-1"]),
  departed: new Set<string>(),
} as const;

describe("departure constants", () => {
  it("puts the departure ring outside the arrival ring", () => {
    // The two-tier design collapses if these are ever equal or inverted: the
    // bus would report leaving a stop it was still standing at.
    expect(DEPARTED_METERS).toBeGreaterThan(ARRIVING_METERS);
  });

  it("is wide enough to survive GPS jitter at the kerb", () => {
    // A bus idling at a stop drifts tens of metres between fixes. A threshold
    // inside that band would tell waiting families the bus had left while it
    // was still parked beside them.
    expect(DEPARTED_METERS).toBeGreaterThanOrEqual(250);
  });
});

describe("newlyDeparted", () => {
  it("says nothing about a bus still standing at the stop", () => {
    expect(newlyDeparted({ ...baseInput, position: northOf(STOP, 20) })).toEqual([]);
  });

  it("reports the stop once the bus is clearly past it", () => {
    const decisions = newlyDeparted({ ...baseInput, position: northOf(STOP, 500) });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ stopId: "stop-1", stopName: "Aundh IT Park" });
    expect(decisions[0]!.distanceMeters).toBeGreaterThan(480);
    expect(decisions[0]!.distanceMeters).toBeLessThan(520);
  });

  it("never reports a stop the bus has not arrived at first", () => {
    // The whole safety argument: a bus 500 m from a stop it never served is
    // simply far away. Treating that as "departed" would accuse a driver of
    // leaving a child behind on every run past an unserved stop.
    const decisions = newlyDeparted({
      ...baseInput,
      arrived: new Set<string>(),
      position: northOf(STOP, 500),
    });

    expect(decisions).toEqual([]);
  });

  it("does not report the same departure twice", () => {
    // The dedup set comes from the `StopApproach` row the caller claims. A
    // second report would re-alert a family that has already been told.
    const decisions = newlyDeparted({
      ...baseInput,
      departed: new Set(["stop-1"]),
      position: northOf(STOP, 700),
    });

    expect(decisions).toEqual([]);
  });

  it("does not report a departure while the bus is between the rings", () => {
    // 250 m is outside the arrival ring but inside the departure ring: the bus
    // has pulled away a little, not left. It must not fire until 300 m.
    expect(newlyDeparted({ ...baseInput, position: northOf(STOP, 250) })).toEqual([]);
    expect(newlyDeparted({ ...baseInput, position: northOf(STOP, 301) })).toHaveLength(1);
  });

  it("reports each departed stop on the route, not just the first", () => {
    // Two stops already served; the bus is now past both. Reporting only the
    // first would leave the second stop's families permanently silent.
    const second: BoardingStop = {
      id: "stop-2",
      name: "Shivajinagar",
      lat: STOP.lat - 600 / 111_132,
      lng: STOP.lng,
    };
    const decisions = newlyDeparted({
      ...baseInput,
      stops: [STOP, second],
      arrived: new Set(["stop-1", "stop-2"]),
      position: northOf(STOP, 600),
    });

    expect(decisions.map((d) => d.stopId).sort()).toEqual(["stop-1", "stop-2"]);
  });

  it("honours an overridden threshold, so a caller can widen the ring", () => {
    const decisions = newlyDeparted({
      ...baseInput,
      position: northOf(STOP, 200),
      departedAfterMeters: 150,
    });

    expect(decisions).toHaveLength(1);
  });
});

describe("departureOutcome", () => {
  it("marks a waiting student missed — the case that must reach a guardian", () => {
    // They pressed "I'm waiting", the bus came, and it left without them.
    expect(departureOutcome("WAITING")).toBe("MISSED");
  });

  it("marks a student who never showed absent, not missed", () => {
    // Nobody was at the stop. Attendance bookkeeping, not an alarm — treating
    // it as MISSED would cry wolf on every student who simply did not travel.
    expect(departureOutcome("PENDING")).toBe("ABSENT");
  });

  it("never demotes a student who was already ticked on", () => {
    // The bus pulls away from the stop that boarded them, so a departure is
    // observed at every stop. A child already on board must not be reported
    // left behind the moment their own stop is served.
    expect(departureOutcome("PICKED")).toBeNull();
  });

  it("does not re-resolve a record that is already resolved", () => {
    // Idempotence: the departure is reported once per run, but a restart or a
    // racing tick could still reach here twice.
    expect(departureOutcome("MISSED")).toBeNull();
    expect(departureOutcome("ABSENT")).toBeNull();
  });
});

describe("isSafetyCritical", () => {
  it("is true only for a student left behind", () => {
    expect(isSafetyCritical("MISSED")).toBe(true);
    expect(isSafetyCritical("ABSENT")).toBe(false);
    expect(isSafetyCritical(null)).toBe(false);
  });
});
