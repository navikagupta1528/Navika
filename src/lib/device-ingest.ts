/**
 * Admission control for the hardware ingestion endpoint.
 *
 * Same shape as `login-throttle.ts`: the decision is pure and takes the clock as
 * an argument, so the schedule is tested in a millisecond instead of by waiting
 * through it. The only state is a map the caller creates, and it is created once
 * per process.
 *
 * Two different intervals, because the endpoint answers two different questions:
 *
 *   - Should this ping be broadcast at all? A tracker misconfigured to post
 *     every 100 ms must not be able to flood every watcher's map. The minimum
 *     interval drops the duplicates.
 *   - Should this ping also be written to Postgres and run the watchers? The
 *     same split the driver's socket uses: broadcast often, persist rarely.
 */

/** Drop pings closer together than this, per device. */
export const INGEST_MIN_INTERVAL_MS = 2_000;

/** Persist and run the geofence/boarding/driving watchers this often, at most. */
export const INGEST_PERSIST_INTERVAL_MS = 15_000;

export type IngestAdmission = {
  /** Broadcast this ping? False means drop it. */
  accept: boolean;
  /** Also write to Postgres and run the watchers? */
  persist: boolean;
  /** How long the caller should wait before retrying, when refused. */
  retryAfterMs: number;
};

export type IngestGate = {
  admit(deviceId: string, nowMs: number): IngestAdmission;
};

/**
 * Create one gate.
 *
 * Keyed by device id rather than by IP, because a fleet behind one NAT is the
 * normal case and a shared IP would make every bus's pings throttle each other.
 *
 * The state is in-process, and that is deliberate. Two instances behind a load
 * balancer each keep their own map, so the effective interval can be halved;
 * that is a bound on cost, not a correctness property, and it is why the
 * database write cadence is expressed here rather than inferred from arrivals.
 */
export function createIngestGate(): IngestGate {
  const last = new Map<string, { ping: number; persist: number }>();

  return {
    admit(deviceId, nowMs) {
      const previous = last.get(deviceId);

      if (previous && nowMs - previous.ping < INGEST_MIN_INTERVAL_MS) {
        return {
          accept: false,
          persist: false,
          retryAfterMs: INGEST_MIN_INTERVAL_MS - (nowMs - previous.ping),
        };
      }

      const persist = !previous || nowMs - previous.persist >= INGEST_PERSIST_INTERVAL_MS;
      last.set(deviceId, {
        ping: nowMs,
        // Keep the last persist time rather than this ping's, so "persist every
        // 15 s" cannot be defeated by pings arriving just under the minimum.
        persist: persist ? nowMs : (previous?.persist ?? nowMs),
      });

      return { accept: true, persist, retryAfterMs: 0 };
    },
  };
}
