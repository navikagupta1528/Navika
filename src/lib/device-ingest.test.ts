import { describe, expect, it } from "vitest";
import {
  INGEST_MIN_INTERVAL_MS,
  INGEST_PERSIST_INTERVAL_MS,
  createIngestGate,
} from "./device-ingest";

const T0 = 1_760_000_000_000;

describe("createIngestGate", () => {
  it("accepts the first ping and persists it", () => {
    const gate = createIngestGate();
    const admission = gate.admit("dev-1", T0);
    expect(admission).toEqual({ accept: true, persist: true, retryAfterMs: 0 });
  });

  it("drops a ping that arrives inside the minimum interval", () => {
    const gate = createIngestGate();
    gate.admit("dev-1", T0);
    const admission = gate.admit("dev-1", T0 + INGEST_MIN_INTERVAL_MS - 1);
    expect(admission.accept).toBe(false);
    expect(admission.persist).toBe(false);
    expect(admission.retryAfterMs).toBe(1);
  });

  it("accepts a ping exactly at the minimum interval", () => {
    const gate = createIngestGate();
    gate.admit("dev-1", T0);
    expect(gate.admit("dev-1", T0 + INGEST_MIN_INTERVAL_MS).accept).toBe(true);
  });

  it("broadcasts on the ping cadence but persists on the slower one", () => {
    const gate = createIngestGate();
    expect(gate.admit("dev-1", T0).persist).toBe(true);

    // Fast pings arrive and are broadcast, but not persisted.
    let t = T0;
    for (let i = 0; i < 6; i += 1) {
      t += INGEST_MIN_INTERVAL_MS;
      expect(gate.admit("dev-1", t)).toEqual({
        accept: true,
        persist: false,
        retryAfterMs: 0,
      });
    }

    // The next ping past the persist interval writes again.
    t = T0 + INGEST_PERSIST_INTERVAL_MS;
    expect(gate.admit("dev-1", t).persist).toBe(true);
  });

  it("cannot be tricked into persisting early by back-to-back pings", () => {
    const gate = createIngestGate();
    gate.admit("dev-1", T0);
    // A burst of accepted pings just above the minimum must not drag the
    // persist clock forward with them.
    gate.admit("dev-1", T0 + INGEST_MIN_INTERVAL_MS);
    const admission = gate.admit("dev-1", T0 + INGEST_MIN_INTERVAL_MS + 1);
    expect(admission.persist).toBe(false);
  });

  it("tracks devices independently", () => {
    const gate = createIngestGate();
    gate.admit("dev-1", T0);
    // A second device genuinely is a different bus; its first ping persists.
    expect(gate.admit("dev-2", T0 + 10).persist).toBe(true);
    expect(gate.admit("dev-1", T0 + 10).accept).toBe(false);
  });
});
