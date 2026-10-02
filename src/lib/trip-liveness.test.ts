import { describe, expect, it } from "vitest";
import {
  ABANDONED_TRIP_AFTER_MS,
  abandonedCutoff,
  isTripAbandoned,
  lastActivityAt,
  type LivenessTrip,
} from "./trip-liveness";

const HOUR = 60 * 60 * 1000;

/** A fixed "now" so every assertion below is exact rather than approximate. */
const NOW = Date.parse("2026-10-02T12:00:00.000Z");

const at = (ms: number) => new Date(ms);

const trip = (overrides: Partial<LivenessTrip> = {}): LivenessTrip => ({
  status: "ONGOING",
  startedAt: at(NOW - 2 * HOUR),
  createdAt: at(NOW - 2 * HOUR - HOUR),
  updatedAt: at(NOW - 2 * HOUR),
  bus: { lastLocationAt: at(NOW - 2 * HOUR) },
  ...overrides,
});

describe("ABANDONED_TRIP_AFTER_MS", () => {
  it("clears a whole route run with room to spare", () => {
    // The longest real run is under two hours, so the threshold has to sit
    // above it or a healthy trip at the end of its route gets closed.
    expect(ABANDONED_TRIP_AFTER_MS).toBeGreaterThan(2 * HOUR);
  });

  it("still closes a stuck trip the same day", () => {
    expect(ABANDONED_TRIP_AFTER_MS).toBeLessThanOrEqual(6 * HOUR);
  });
});

describe("lastActivityAt", () => {
  it("is the start time for a run with no ping yet", () => {
    expect(lastActivityAt(trip({ bus: { lastLocationAt: null } }))).toBe(
      NOW - 2 * HOUR,
    );
  });

  it("prefers the freshest signal", () => {
    const value = lastActivityAt(
      trip({
        startedAt: at(NOW - 5 * HOUR),
        createdAt: at(NOW - 5 * HOUR),
        updatedAt: at(NOW - 4 * HOUR),
        bus: { lastLocationAt: at(NOW - 60_000) },
      }),
    );
    expect(value).toBe(NOW - 60_000);
  });

  it("ignores a bus ping that predates the trip", () => {
    // The bus column is not per-trip. A ping left over from the previous run
    // says nothing about this one, and trusting it would hold a dead trip
    // open for as long as the next run lasted.
    const value = lastActivityAt(
      trip({
        startedAt: at(NOW - HOUR),
        bus: { lastLocationAt: at(NOW - 3 * HOUR) },
      }),
    );
    expect(value).toBe(NOW - HOUR);
  });

  it("keeps a ping that lands exactly on the start", () => {
    // Boundary: the first ping of a run can arrive in the same millisecond as
    // the write that started it, and it is the only live signal there is.
    const value = lastActivityAt(
      trip({
        startedAt: at(NOW - HOUR),
        createdAt: at(NOW - HOUR),
        updatedAt: at(NOW - HOUR),
        bus: { lastLocationAt: at(NOW - HOUR) },
      }),
    );
    expect(value).toBe(NOW - HOUR);
  });

  it("falls back to creation time when the run never started", () => {
    const value = lastActivityAt(
      trip({
        startedAt: null,
        createdAt: at(NOW - 5 * HOUR),
        updatedAt: at(NOW - 4 * HOUR),
        bus: { lastLocationAt: null },
      }),
    );
    expect(value).toBe(NOW - 4 * HOUR);
  });

  it("returns null when there is nothing to go on", () => {
    expect(
      lastActivityAt({
        status: "ONGOING",
        startedAt: null,
        createdAt: null,
        updatedAt: null,
        bus: null,
      }),
    ).toBeNull();
  });

  it("survives a bus projection that is not loaded", () => {
    expect(lastActivityAt(trip({ bus: undefined as never }))).toBe(NOW - 2 * HOUR);
  });

  it("ignores an invalid Date rather than producing NaN", () => {
    // Number.isNaN in a max() comparison would make the whole result NaN, and
    // every downstream date comparison with NaN is silently false - the trip
    // would look immortal rather than abandoned.
    expect(
      lastActivityAt(trip({ bus: { lastLocationAt: new Date("not a date") } })),
    ).toBe(NOW - 2 * HOUR);
  });
});

describe("isTripAbandoned", () => {
  it("is false for a run that pinged a moment ago", () => {
    expect(isTripAbandoned(trip(), NOW)).toBe(false);
  });

  it("is true once the silence exceeds the threshold", () => {
    expect(
      isTripAbandoned(
        trip({
          startedAt: at(NOW - 5 * HOUR),
          createdAt: at(NOW - 5 * HOUR),
          updatedAt: at(NOW - 5 * HOUR),
          bus: { lastLocationAt: at(NOW - 5 * HOUR) },
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("treats the threshold itself as still alive", () => {
    // Strictly greater than. A trip exactly at the limit has had every second
    // it was promised, and closing it would race a driver who is mid-run.
    expect(
      isTripAbandoned(
        trip({
          startedAt: at(NOW - ABANDONED_TRIP_AFTER_MS),
          createdAt: at(NOW - ABANDONED_TRIP_AFTER_MS),
          updatedAt: at(NOW - ABANDONED_TRIP_AFTER_MS),
          bus: { lastLocationAt: at(NOW - ABANDONED_TRIP_AFTER_MS) },
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is true one millisecond past the threshold", () => {
    const past = NOW - ABANDONED_TRIP_AFTER_MS - 1;
    expect(
      isTripAbandoned(
        trip({
          startedAt: at(past),
          createdAt: at(past),
          updatedAt: at(past),
          bus: { lastLocationAt: at(past) },
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("never abandons a trip that is not ONGOING", () => {
    const dead = {
      startedAt: at(NOW - 99 * HOUR),
      createdAt: at(NOW - 99 * HOUR),
      updatedAt: at(NOW - 99 * HOUR),
      bus: { lastLocationAt: at(NOW - 99 * HOUR) },
    };
    for (const status of ["SCHEDULED", "COMPLETED", "CANCELLED"]) {
      expect(isTripAbandoned({ ...dead, status }, NOW)).toBe(false);
    }
  });

  it("leaves an undated ONGOING trip alone", () => {
    // "Cannot tell" must not become "close it". An undated running trip is
    // more likely a live run on a clock we did not record than a dead row, and
    // quietly completing it would contradict what is actually happening.
    expect(
      isTripAbandoned(
        {
          status: "ONGOING",
          startedAt: null,
          createdAt: null,
          updatedAt: null,
          bus: null,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("is driven by the bus ping, not just the start", () => {
    // A six-hour run that pinged ten seconds ago is alive. Keying only off
    // startedAt would close every long route at the 3-hour mark.
    expect(
      isTripAbandoned(
        trip({
          startedAt: at(NOW - 6 * HOUR),
          createdAt: at(NOW - 6 * HOUR),
          updatedAt: at(NOW - 6 * HOUR),
          bus: { lastLocationAt: at(NOW - 10_000) },
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("abandonedCutoff", () => {
  it("sits exactly one threshold behind now", () => {
    expect(abandonedCutoff(NOW).getTime()).toBe(NOW - ABANDONED_TRIP_AFTER_MS);
  });

  it("narrows the candidate set without excluding a live trip", () => {
    // The cutoff is only used to pick which rows to examine, so the only
    // requirement is that it never drops a row the pure rule would call
    // abandoned. Every signal feeds into liveness, so the guard column has to
    // be the earliest of them.
    const stale = trip({
      startedAt: at(NOW - 4 * HOUR),
      createdAt: at(NOW - 4 * HOUR),
      updatedAt: at(NOW - 4 * HOUR),
      bus: { lastLocationAt: at(NOW - 4 * HOUR) },
    });
    expect(lastActivityAt(stale)).toBeLessThan(abandonedCutoff(NOW).getTime());
  });
});