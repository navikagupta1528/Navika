import { describe, expect, it } from "vitest";
import {
  advance,
  buildPath,
  initialState,
  metersFor,
  nextStop,
  positionAt,
  reverseState,
  SPEED_MPS,
  MAX_CATCHUP_METERS,
  type SimStop,
} from "./simulator";

/**
 * A north-south route of four stops, each ~1.1 km apart, so a segment is a
 * predictable length and assertions can use round numbers.
 */
const raw: SimStop[] = [
  { id: "a", name: "A", stopOrder: 1, lat: 28.5355, lng: 77.391 },
  { id: "b", name: "B", stopOrder: 2, lat: 28.5455, lng: 77.391 },
  { id: "c", name: "C", stopOrder: 3, lat: 28.5555, lng: 77.391 },
  { id: "d", name: "D", stopOrder: 4, lat: 28.5655, lng: 77.391 },
];

const path = buildPath(raw);

/**
 * The length of the first segment, taken from the path's own offsets.
 *
 * Not `lengthMeters / 3`. The three segments are equal to within floating point
 * but not exactly equal, so dividing the total gives a figure a few nanometres
 * off - which is enough for `remaining < distance` to be false when it should be
 * true, and the test then fails for a reason that has nothing to do with the code.
 */
const SEG = path.offsetsMeters[1]!;

describe("buildPath", () => {
  it("orders the stops by stopOrder, not by input order", () => {
    // There is no index guaranteeing this ordering, so relying on what the
    // database returns would have the bus driving the route backwards at random.
    const shuffled = [raw[2]!, raw[0]!, raw[3]!, raw[1]!];
    expect(buildPath(shuffled).stops.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("measures the whole route", () => {
    expect(path.lengthMeters).toBeGreaterThan(SEG * 3 - 1);
    expect(path.lengthMeters).toBeLessThan(SEG * 3 + 1);
  });

  it("offsets run from zero to the total length", () => {
    expect(path.offsetsMeters[0]).toBe(0);
    expect(path.offsetsMeters.at(-1)).toBeCloseTo(path.lengthMeters, 6);
  });

  it("has increasing offsets", () => {
    for (let i = 1; i < path.offsetsMeters.length; i++) {
      expect(path.offsetsMeters[i]!).toBeGreaterThan(path.offsetsMeters[i - 1]!);
    }
  });

  it("gives a zero-length path for an empty route rather than NaN", () => {
    const empty = buildPath([]);
    expect(empty.lengthMeters).toBe(0);
    expect(empty.offsetsMeters).toEqual([0]);
  });

  it("handles two stops at the same point without dividing by zero", () => {
    const doubled = buildPath([
      { id: "x", name: "X", stopOrder: 1, lat: 28.5, lng: 77.4 },
      { id: "y", name: "Y", stopOrder: 2, lat: 28.5, lng: 77.4 },
    ]);
    expect(doubled.lengthMeters).toBe(0);
    expect(Number.isFinite(positionAt(initialState(), doubled)!.lat)).toBe(true);
  });
});

describe("advance", () => {
  it("does nothing on a zero-length route", () => {
    const empty = buildPath([]);
    const state = initialState();
    expect(advance(state, empty, 500)).toEqual({ state, arrivedAt: [] });
  });

  it("does nothing for zero, negative or non-finite distance", () => {
    const state = initialState();
    expect(advance(state, path, 0).state).toEqual(state);
    expect(advance(state, path, -10).state).toEqual(state);
    expect(advance(state, path, NaN).state).toEqual(state);
  });

  it("moves part way along the route", () => {
    const { state, arrivedAt } = advance(initialState(), path, SEG * 0.5);
    expect(state.alongMeters).toBeCloseTo(SEG * 0.5, 6);
    expect(state.direction).toBe(1);
    expect(arrivedAt).toHaveLength(0);
  });

  it("arrives at the next stop and reports it", () => {
    const { state, arrivedAt } = advance(initialState(), path, SEG);
    expect(arrivedAt.map((s) => s.id)).toEqual(["b"]);
    expect(state.alongMeters).toBeCloseTo(SEG, 6);
  });

  it("reports several stops when one tick is longer than a segment", () => {
    // A long tick must announce every stop it passed, not only the last: the
    // caller would otherwise announce a stop the bus has already left behind.
    const { arrivedAt } = advance(initialState(), path, SEG * 2.5);
    expect(arrivedAt.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("reverses at the terminus instead of jumping to the first stop", () => {
    // Wrapping would have the bus cross several kilometres of open country
    // between D and A in a single tick. A bus turns round.
    const { state, arrivedAt } = advance(initialState(), path, path.lengthMeters);
    expect(arrivedAt.map((s) => s.id)).toEqual(["b", "c", "d"]);
    expect(state.direction).toBe(-1);
    expect(state.alongMeters).toBeCloseTo(path.lengthMeters, 6);
  });

  it("reverses again at the far end and travels back", () => {
    const out = advance(initialState(), path, path.lengthMeters);
    expect(out.state.direction).toBe(-1);

    // Half a segment home, still heading back - one more leg is not enough to
    // reach A and turn round again.
    const back = advance(out.state, path, SEG * 0.5);
    expect(back.state.direction).toBe(-1);
    expect(back.state.alongMeters).toBeCloseTo(path.lengthMeters - SEG * 0.5, 6);
    expect(back.arrivedAt).toHaveLength(0);
  });

  it("turns round again on reaching the start of the route", () => {
    // A full there-and-back in one call: out to D, back to A, and facing
    // outbound again. Without the reversal at both ends the bus would stop dead
    // at A and the demo would look frozen.
    const out = advance(initialState(), path, path.lengthMeters);
    // D was announced on the way out, so the return leg announces c, b, a.
    expect(out.arrivedAt.map((s) => s.id)).toEqual(["b", "c", "d"]);

    const home = advance(out.state, path, path.lengthMeters);
    expect(home.arrivedAt.map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(home.state.direction).toBe(1);
    expect(home.state.alongMeters).toBeCloseTo(0, 6);
  });

  it("never reports a stop twice on one leg", () => {
    const { arrivedAt } = advance(initialState(), path, path.lengthMeters);
    expect(new Set(arrivedAt.map((s) => s.id)).size).toBe(arrivedAt.length);
  });

  it("announces every stop over a full there-and-back run", () => {
    let state = initialState();
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      const step = advance(state, path, SEG * 0.4);
      state = step.state;
      seen.push(...step.arrivedAt.map((s) => s.id));
    }
    expect(seen).toContain("b");
    expect(seen).toContain("c");
    expect(seen).toContain("d");
    // And coming back, the stops in the opposite order.
    expect(seen.indexOf("c")).toBeLessThan(seen.indexOf("d"));
  });

  it("stays within the route however far it is told to go", () => {
    // The bounded loop can exit early; the bus must still end up somewhere legal.
    for (const meters of [1, 100, 10_000, 1e9]) {
      const { state } = advance(initialState(), path, meters);
      expect(state.alongMeters).toBeGreaterThanOrEqual(0);
      expect(state.alongMeters).toBeLessThanOrEqual(path.lengthMeters + 1e-6);
    }
  });

  it("accumulates over many small ticks to the same place as one big one", () => {
    // The runner ticks every few seconds. If the maths differed between one tick
    // and a thousand, the bus would drift off the route over a demo.
    let state = initialState();
    for (let i = 0; i < 100; i++) state = advance(state, path, 10).state;
    const oneShot = advance(initialState(), path, 1000).state;
    expect(state.alongMeters).toBeCloseTo(oneShot.alongMeters, 4);
  });

  it("starts a return leg from the terminus", () => {
    const state = reverseState(path);
    const { state: moved } = advance(state, path, SEG * 0.5);
    expect(moved.direction).toBe(-1);
    expect(moved.alongMeters).toBeCloseTo(path.lengthMeters - SEG * 0.5, 6);
  });
});

describe("positionAt", () => {
  it("starts on the first stop", () => {
    const p = positionAt(initialState(), path)!;
    expect(p.lat).toBeCloseTo(raw[0]!.lat, 6);
    expect(p.alongMeters).toBe(0);
  });

  it("interpolates between stops", () => {
    const { state } = advance(initialState(), path, SEG * 0.5);
    const p = positionAt(state, path)!;
    expect(p.lat).toBeGreaterThan(raw[0]!.lat);
    expect(p.lat).toBeLessThan(raw[1]!.lat);
  });

  it("sits exactly on a stop when it arrives there", () => {
    const { state } = advance(initialState(), path, SEG);
    const p = positionAt(state, path)!;
    // Not 1.2e-13 past it. That residue is what makes an arrival unannounceable.
    expect(p.lat).toBeCloseTo(raw[1]!.lat, 6);
  });

  it("heads due north on the outbound leg", () => {
    // 0 is the correct bearing for due north, not a wrap-around bug.
    expect(positionAt(initialState(), path)!.headingDeg).toBeCloseTo(0, 1);
  });

  it("heads due south on the return leg", () => {
    // Reversal has to flip the heading, not just the position. A bus turned round
    // with its marker still pointing the way it came undermines the whole demo.
    const atEnd = advance(initialState(), path, path.lengthMeters).state;
    const back = advance(atEnd, path, SEG * 0.5).state;
    expect(positionAt(back, path)!.headingDeg).toBeCloseTo(180, 1);
  });

  it("gives an eastward heading on an east-west route", () => {
    // Guards against the previous two tests both running on a vertical line.
    const east = buildPath([
      { id: "p", name: "P", stopOrder: 1, lat: 28.5, lng: 77.39 },
      { id: "q", name: "Q", stopOrder: 2, lat: 28.5, lng: 77.41 },
    ]);
    expect(positionAt(initialState(), east)!.headingDeg).toBeCloseTo(90, 0);
  });

  it("sits on the only stop of a one-stop route instead of returning null", () => {
    // Still on the map beats vanishing.
    const solo = buildPath([raw[0]!]);
    const p = positionAt(initialState(), solo)!;
    expect(p.lat).toBe(raw[0]!.lat);
    expect(p.headingDeg).toBe(0);
  });

  it("returns null for an empty route", () => {
    expect(positionAt(initialState(), buildPath([]))).toBeNull();
  });

  it("always yields coordinates and a heading the map will accept", () => {
    let state = initialState();
    for (let i = 0; i < 60; i++) {
      state = advance(state, path, SEG * 0.3).state;
      const p = positionAt(state, path)!;
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.lng).toBeGreaterThanOrEqual(-180);
      expect(p.lng).toBeLessThanOrEqual(180);
      expect(p.headingDeg).toBeGreaterThanOrEqual(0);
      expect(p.headingDeg).toBeLessThanOrEqual(360);
    }
  });
});

describe("nextStop", () => {
  it("is the second stop on the outbound leg", () => {
    expect(nextStop(initialState(), path)!.stop.id).toBe("b");
  });

  it("is the previous stop on the return leg", () => {
    // Half a segment back from D, so the next stop behind the bus is C.
    const back = advance(reverseState(path), path, SEG * 0.5).state;
    expect(back.direction).toBe(-1);
    expect(nextStop(back, path)!.stop.id).toBe("c");
  });

  it("is C, not D, at the moment the bus turns round at D", () => {
    // The bus is standing on D, so D is not "next" - it is where it is. The next
    // stop ahead on the return leg is C.
    const back = advance(reverseState(path), path, 1).state;
    expect(nextStop(back, path)!.stop.id).toBe("c");
  });

  it("reports the remaining distance, shrinking as the bus approaches", () => {
    const near = advance(initialState(), path, SEG * 0.9).state;
    expect(nextStop(near, path)!.remainingMeters).toBeCloseTo(SEG * 0.1, 3);
  });

  it("moves on once the bus has passed a stop", () => {
    const past = advance(initialState(), path, SEG * 1.1).state;
    expect(nextStop(past, path)!.stop.id).toBe("c");
  });

  it("is null at the end of the line while still heading outbound", () => {
    // Constructed rather than reached by driving, because `advance` reverses
    // direction the instant it arrives - so a driven-to state is already facing
    // inbound and legitimately has a next stop. This is the moment between
    // arriving and turning, and there is genuinely nothing ahead.
    const atEnd = { alongMeters: path.lengthMeters, direction: 1 as const };
    expect(nextStop(atEnd, path)).toBeNull();
  });

  it("is null at the start of the line while still heading inbound", () => {
    const atStart = { alongMeters: 0, direction: -1 as const };
    expect(nextStop(atStart, path)).toBeNull();
  });

  it("is null on an empty route", () => {
    expect(nextStop(initialState(), buildPath([]))).toBeNull();
  });
});

describe("metersFor", () => {
  it("converts elapsed time at the configured speed", () => {
    expect(metersFor(10_000, "city")).toBeCloseTo(10 * SPEED_MPS.city, 6);
  });

  it("is zero for a non-positive or non-finite elapsed time", () => {
    expect(metersFor(0, "city")).toBe(0);
    expect(metersFor(-5, "city")).toBe(0);
    expect(metersFor(NaN, "city")).toBe(0);
  });

  it("clamps a long gap so the bus does not teleport", () => {
    // After a deploy or a suspended laptop, an unclamped simulator would move the
    // bus kilometres in one tick and every watching parent would see it jump.
    expect(metersFor(3_600_000, "city")).toBeCloseTo(MAX_CATCHUP_METERS, 6);
  });

  it("does not clamp a normal tick", () => {
    expect(metersFor(4_000, "city")).toBeLessThan(MAX_CATCHUP_METERS);
  });

  it("travels further at a higher speed over the same time", () => {
    expect(metersFor(10_000, "highway")).toBeGreaterThan(metersFor(10_000, "city"));
    expect(metersFor(10_000, "walking")).toBeLessThan(metersFor(10_000, "city"));
  });
});