import { describe, expect, it } from "vitest";
import { isSameOrder, stopOrderPlan, validateReorder } from "./route-order";

/** A route with five stops, in visiting order. */
const current = [
  { id: "rs1" },
  { id: "rs2" },
  { id: "rs3" },
  { id: "rs4" },
  { id: "rs5" },
];

describe("validateReorder", () => {
  it("accepts a genuine reorder", () => {
    const result = validateReorder(current, ["rs5", "rs1", "rs2", "rs3", "rs4"]);
    expect(result).toEqual({ ok: true, order: ["rs5", "rs1", "rs2", "rs3", "rs4"] });
  });

  it("accepts the unchanged order, so a no-op drag is not an error", () => {
    const result = validateReorder(current, ["rs1", "rs2", "rs3", "rs4", "rs5"]);
    expect(result.ok).toBe(true);
  });

  it("returns a copy, so a later mutation of the caller's array cannot change the result", () => {
    const submitted = ["rs1", "rs2", "rs3", "rs4", "rs5"];
    const result = validateReorder(current, submitted);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    submitted[0] = "tampered";
    expect(result.order[0]).toBe("rs1");
  });

  it("rejects a list that is short, which would silently drop a stop", () => {
    // The failure this exists to prevent: a stale tab submits four ids for a
    // route that now has five, and the write drops a student from their pickup.
    const result = validateReorder(current, ["rs1", "rs2", "rs3", "rs4"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/changed while you were dragging/i);
  });

  it("rejects a list that is long, which would invent a stop", () => {
    const result = validateReorder(current, ["rs1", "rs2", "rs3", "rs4", "rs5", "rs6"]);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty list against a non-empty route", () => {
    expect(validateReorder(current, []).ok).toBe(false);
  });

  it("rejects a duplicated id", () => {
    const result = validateReorder(current, ["rs1", "rs1", "rs3", "rs4", "rs5"]);
    expect(result.ok).toBe(false);
  });

  it("rejects an id that is not on this route", () => {
    // A stop moved from another route must not be adopted into this one.
    const result = validateReorder(current, ["rs1", "rs2", "rs3", "rs4", "rs99"]);
    expect(result.ok).toBe(false);
  });

  it("rejects when the stored order has duplicate ids, rather than computing an answer", () => {
    // The data is already inconsistent, so there is no correct order to derive.
    const result = validateReorder([{ id: "a" }, { id: "a" }], ["a", "b"]);
    expect(result.ok).toBe(false);
  });

  it("reports a route with no stops distinctly from a version mismatch", () => {
    // "This route has no stops" is a fact about the route. "Changed while you
    // were dragging" tells the admin to reload, which would be pointless advice
    // for a route that simply has nothing on it.
    const result = validateReorder([], []);
    expect(result).toEqual({ ok: false, error: "This route has no stops to reorder." });
  });

  it("handles a single-stop route, which is valid but not reorderable", () => {
    expect(validateReorder([{ id: "only" }], ["only"]).ok).toBe(true);
  });

  it("does not mutate the current order it was given", () => {
    const before = current.map((s) => s.id);
    validateReorder(current, ["rs5", "rs4", "rs3", "rs2", "rs1"]);
    expect(current.map((s) => s.id)).toEqual(before);
  });
});

describe("isSameOrder", () => {
  it("is true for an identical order", () => {
    expect(isSameOrder(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("is false for a different order", () => {
    expect(isSameOrder(["a", "b", "c"], ["b", "a", "c"])).toBe(false);
  });

  it("is false for a different length, even when one is a prefix of the other", () => {
    expect(isSameOrder(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isSameOrder([], ["a"])).toBe(false);
  });
});

describe("stopOrderPlan", () => {
  it("parks every row on a distinct negative slot before assigning", () => {
    const { park } = stopOrderPlan(["a", "b", "c"], ["c", "b", "a"]);
    const slots = park.map((s) => s.stopOrder);
    expect(slots).toEqual([-1, -2, -3]);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("assigns the final 1..n in the requested order", () => {
    const { assign } = stopOrderPlan(["a", "b", "c"], ["c", "b", "a"]);
    expect(assign).toEqual([
      { id: "c", stopOrder: 1 },
      { id: "b", stopOrder: 2 },
      { id: "a", stopOrder: 3 },
    ]);
  });

  it("covers every stop exactly once within each phase", () => {
    // Each phase touches every row once, so a stop missing from either phase
    // would be left holding its old position and appear twice in the sequence.
    const ids = ["a", "b", "c", "d"];
    const { park, assign } = stopOrderPlan(ids, ["d", "c", "b", "a"]);
    expect([...park.map((s) => s.id)].sort()).toEqual([...ids].sort());
    expect([...assign.map((s) => s.id)].sort()).toEqual([...ids].sort());
  });

  it("never lets a final assignment collide with a parking slot", () => {
    // This is the property the two-phase write exists for: assigning positions
    // directly would trip @@unique([routeId, stopOrder]) the moment two rows were
    // given positions that others still held.
    const ids = ["a", "b", "c", "d", "e"];
    const { park, assign } = stopOrderPlan(ids, ["e", "d", "c", "b", "a"]);
    const parked = new Set(park.map((s) => s.stopOrder));
    for (const s of assign) {
      expect(parked.has(s.stopOrder)).toBe(false);
    }
    expect(new Set(assign.map((s) => s.stopOrder)).size).toBe(assign.length);
  });

  it("keeps parking slots unique even for a long route", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `rs${i}`);
    const { park, assign } = stopOrderPlan(ids, ids.slice().reverse());
    expect(new Set(park.map((s) => s.stopOrder)).size).toBe(40);
    expect(new Set(assign.map((s) => s.stopOrder)).size).toBe(40);
  });

  it("handles a single stop", () => {
    expect(stopOrderPlan(["a"], ["a"])).toEqual({
      park: [{ id: "a", stopOrder: -1 }],
      assign: [{ id: "a", stopOrder: 1 }],
    });
  });
});
