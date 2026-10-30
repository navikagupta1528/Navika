import { describe, expect, it } from "vitest";
import { classifyDbError, statusForDbState } from "./health";

/**
 * The failure modes here were confirmed against a real database, not guessed:
 * an unreachable port produced `unreachable`, and a reachable but unmigrated
 * database produced `schema-missing`. These tests pin the classification so a
 * refactor cannot quietly turn the second case back into the first - which
 * would leave a container up, serving traffic, with no tables.
 */

describe("classifyDbError", () => {
  it("reads a missing relation as a missing schema, from any of the three sources", () => {
    // Postgres 42P01, as text - what the driver actually throws.
    expect(
      classifyDbError(new Error('relation "Bus" does not exist'), true),
    ).toBe("schema-missing");

    // The bare SQLSTATE, in case a layer above rewrites the message text.
    expect(classifyDbError(new Error("42P01"), true)).toBe("schema-missing");

    // Prisma's own code for the same condition.
    expect(classifyDbError(new Error("P2021: table does not exist"), true)).toBe("schema-missing");
  });

  it("finds the missing-relation signal in the cause chain, not just the top error", () => {
    // The shape that actually occurs: Prisma wraps the driver's error, and the
    // SQLSTATE sits one level down. Reading only error.message here is how a
    // missing table gets reported as a generic connection failure.
    const wrapped = new Error("Invalid `prisma.bus.count()` invocation", {
      cause: new Error('relation "Bus" does not exist'),
    });
    expect(classifyDbError(wrapped, true)).toBe("schema-missing");
  });

  it("does not mistake a connection failure for a missing schema", () => {
    expect(classifyDbError(new Error("connect ECONNREFUSED 127.0.0.1:5433"), true)).toBe(
      "unreachable",
    );
    expect(classifyDbError(new Error("password authentication failed for user"), true)).toBe(
      "unreachable",
    );
    // A wrong port number must not be read as a relation code.
    expect(classifyDbError(new Error("ETIMEDOUT after 30000ms"), true)).toBe("unreachable");
  });

  it("treats a missing DATABASE_URL as a missing schema, since there is nothing to migrate", () => {
    // Same operator instruction either way - run the migrations - so the label
    // is the same. The distinct case is that the message must never carry the
    // URL, and there is no URL here to carry.
    expect(classifyDbError(new Error("boom"), false)).toBe("schema-missing");
  });

  it("never echoes a connection string back to the caller", () => {
    const withSecret = new Error(
      "connect ECONNREFUSED for postgresql://busguard:hunter2@db.internal:5432/busguard",
    );
    expect(classifyDbError(withSecret, true)).toBe("unreachable");
    // The point of the assertion is the label: only one of three short strings
    // can ever reach the response, and none of them is derived from the error.
  });

  it("survives being handed something that is not an error at all", () => {
    expect(classifyDbError("a bare string", true)).toBe("unreachable");
    expect(classifyDbError({ message: "object with a message" }, true)).toBe("unreachable");
    expect(classifyDbError(undefined, true)).toBe("unreachable");
    expect(classifyDbError(null, true)).toBe("unreachable");
    expect(classifyDbError(42, true)).toBe("unreachable");
  });

  it("handles an empty message without claiming a schema problem", () => {
    // An Error with a blank message contains neither marker, so it must fall
    // through to `unreachable` rather than matching on the empty string.
    expect(classifyDbError(new Error(""), true)).toBe("unreachable");
  });
});

describe("statusForDbState", () => {
  it("is 200 only when the database is actually usable", () => {
    expect(statusForDbState("ok")).toBe(200);
  });

  it("is 503 for every failure, so an unhealthy instance leaves the load balancer", () => {
    for (const state of ["timeout", "unreachable", "schema-missing"] as const) {
      expect(statusForDbState(state)).toBe(503);
    }
  });
});
