import { describe, expect, it } from "vitest";
import {
  APPROACHING_METERS,
  ARRIVING_METERS,
  approachKey,
  geofenceDateKey,
  newlyApproaching,
  type GeofenceStop,
} from "./geofence";
import type { LatLng } from "./geo";

const STOP: GeofenceStop = { id: "stop-1", name: "Aundh IT Park", lat: 18.5308, lng: 73.8477 };

/**
 * A point `meters` due north of the stop.
 *
 * Due north so the arithmetic is a single axis: one degree of latitude is very
 * close to 111 132 m everywhere, whereas longitude shrinks with latitude and
 * would make "500 m away" mean different things on different test coordinates.
 */
function northOf(stop: GeofenceStop, meters: number): LatLng {
  return { lat: stop.lat + meters / 111_132, lng: stop.lng };
}

const baseInput = {
  stops: [STOP],
  notified: new Set<string>(),
  busId: "bus-1",
  direction: "PICKUP",
  date: "2026-10-15",
} as const;

describe("ring constants", () => {
  it("puts the approaching ring outside the arriving ring", () => {
    // The whole two-tier design collapses if these are ever equal or inverted:
    // the bus would either alert once at the stop, or alert at the stop first.
    expect(APPROACHING_METERS).toBeGreaterThan(ARRIVING_METERS);
  });
});

describe("newlyApproaching", () => {
  it("says nothing about a bus that is nowhere near the stop", () => {
    const decisions = newlyApproaching({ ...baseInput, position: northOf(STOP, 2000) });
    expect(decisions).toEqual([]);
  });

  it("fires the outer ring when the bus is inside 800 m", () => {
    const decisions = newlyApproaching({ ...baseInput, position: northOf(STOP, 500) });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      stopId: "stop-1",
      stopName: "Aundh IT Park",
      ring: "APPROACHING",
    });
    // ~500 m, allowing for the metre-per-degree approximation.
    expect(decisions[0]!.distanceMeters).toBeGreaterThan(480);
    expect(decisions[0]!.distanceMeters).toBeLessThan(520);
    expect(decisions[0]!.etaSeconds).toBeGreaterThan(0);
  });

  it("fires the inner ring when the bus is inside 150 m", () => {
    const decisions = newlyApproaching({ ...baseInput, position: northOf(STOP, 100) });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.ring).toBe("ARRIVING");
    // "Arriving" is an event, not a duration.
    expect(decisions[0]!.etaSeconds).toBe(0);
  });

  it("includes a stop just inside a ring and excludes one just outside", () => {
    // The comparison is `distance > ring`, so a stop exactly on the line is
    // inside. Exact-boundary coordinates are not asserted because the spherical
    // distance will not return the nominal figure to the metre — what matters is
    // that just-inside counts and just-outside does not.
    expect(newlyApproaching({ ...baseInput, position: northOf(STOP, 799) })[0]!.ring).toBe(
      "APPROACHING",
    );
    expect(newlyApproaching({ ...baseInput, position: northOf(STOP, 149) })[0]!.ring).toBe(
      "ARRIVING",
    );
    expect(newlyApproaching({ ...baseInput, position: northOf(STOP, 801) })).toEqual([]);
    expect(newlyApproaching({ ...baseInput, position: northOf(STOP, 151) })[0]!.ring).toBe(
      "APPROACHING",
    );
  });

  it("emits only the tighter ring when a fix lands inside both", () => {
    // A bus that jumps, or the first fix out of a tunnel. Two alerts in the same
    // breath — "in 3 minutes" and "arriving now" — is worse than the accurate one.
    const decisions = newlyApproaching({ ...baseInput, position: northOf(STOP, 50) });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.ring).toBe("ARRIVING");
  });

  it("stays silent at a ring that has already been sent", () => {
    const notified = new Set([
      approachKey({
        busId: "bus-1",
        stopId: "stop-1",
        direction: "PICKUP",
        ring: "APPROACHING",
        date: "2026-10-15",
      }),
    ]);

    const decisions = newlyApproaching({
      ...baseInput,
      notified,
      position: northOf(STOP, 500),
    });
    expect(decisions).toEqual([]);
  });

  it("still fires the inner ring when only the outer one was sent", () => {
    // The bus approached, the family was told to get ready, and now it is here.
    // Suppressing this because *a* ring fired would drop the message that
    // actually makes the child leave the house.
    const notified = new Set([
      approachKey({
        busId: "bus-1",
        stopId: "stop-1",
        direction: "PICKUP",
        ring: "APPROACHING",
        date: "2026-10-15",
      }),
    ]);

    const decisions = newlyApproaching({
      ...baseInput,
      notified,
      position: northOf(STOP, 100),
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.ring).toBe("ARRIVING");
  });

  it("checks every stop on the route, not just the first", () => {
    // A second stop 400 m the other side of the bus, so the bus is inside the
    // outer ring of both. Both must fire; reporting only the first would leave
    // one family's stop permanently silent.
    const second: GeofenceStop = {
      id: "stop-2",
      name: "Shivajinagar",
      lat: STOP.lat - 400 / 111_132,
      lng: STOP.lng,
    };
    const decisions = newlyApproaching({
      ...baseInput,
      stops: [STOP, second],
      position: northOf(STOP, 200),
    });

    expect(decisions.map((d) => d.stopId).sort()).toEqual(["stop-1", "stop-2"]);
  });

  it("is unaffected by a notified ring belonging to another day", () => {
    // Yesterday's alert must not silence today's. The date is part of the key
    // for exactly this reason.
    const notified = new Set([
      approachKey({
        busId: "bus-1",
        stopId: "stop-1",
        direction: "PICKUP",
        ring: "APPROACHING",
        date: "2026-10-14",
      }),
    ]);

    expect(
      newlyApproaching({ ...baseInput, notified, position: northOf(STOP, 500) }),
    ).toHaveLength(1);
  });
});

describe("approachKey", () => {
  it("distinguishes every field that makes an alert a different alert", () => {
    const base = {
      busId: "b",
      stopId: "s",
      direction: "PICKUP",
      ring: "APPROACHING" as const,
      date: "2026-10-15",
    };

    const keys = new Set([
      approachKey(base),
      approachKey({ ...base, busId: "b2" }),
      approachKey({ ...base, stopId: "s2" }),
      approachKey({ ...base, direction: "DROPOFF" }),
      approachKey({ ...base, ring: "ARRIVING" }),
      approachKey({ ...base, date: "2026-10-16" }),
    ]);

    // Six inputs, six distinct keys. A collision here is a suppressed alert.
    expect(keys.size).toBe(6);
  });

  it("is stable across calls, so a stored key can be rebuilt", () => {
    const args = {
      busId: "b",
      stopId: "s",
      direction: "PICKUP",
      ring: "ARRIVING" as const,
      date: "2026-10-15",
    };
    expect(approachKey(args)).toBe(approachKey(args));
  });
});

describe("geofenceDateKey", () => {
  it("zero-pads month and day so keys sort and compare as strings", () => {
    // Without padding, "2026-1-5" and "2026-15-1" tie the day against the month
    // and two different days collapse to the same key.
    expect(geofenceDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(geofenceDateKey(new Date(2026, 9, 15))).toBe("2026-10-15");
  });

  it("uses local time, matching the calendar day the trip belongs to", () => {
    // A trip at 11:30 pm local is that calendar day, whatever UTC thinks.
    const lateEvening = new Date(2026, 9, 15, 23, 30, 0);
    expect(geofenceDateKey(lateEvening)).toBe("2026-10-15");
  });
});
