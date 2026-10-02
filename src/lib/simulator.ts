import { bearingDegrees, haversineMeters, lerpLatLng } from "./geo";

/**
 * Route simulation: the maths for moving a bus along its own route.
 *
 * Pure, with no database and no `server-only` import, so it is unit tested. What
 * this deliberately does NOT do is decide when to move or what to persist - that
 * is the runner's job, and it needs a database.
 *
 * Why this exists at all: `Bus.isSimulated` has been in the schema since Phase 0
 * and the badge renders in the fleet and overview screens, but nothing ever wrote
 * the column. The field was a promise the code had not kept. A simulator makes it
 * true, and gives the project something to demonstrate live tracking with when
 * no bus is actually on the road.
 *
 * POSITION IS A DISTANCE ALONG THE ROUTE, not a segment index.
 *
 * An earlier version tracked `segmentIndex` and `progress` and wrapped from the
 * last stop straight back to the first. That is wrong: a straight line from the
 * last stop to the first is several times the length of a normal segment, so the
 * bus covered that gap in one tick and the reported distance jumped by kilometres.
 * It also cannot represent a bus reversing at the end of its route, which is what
 * a bus actually does.
 *
 * Tracking a scalar distance with a direction of travel gets both right for free,
 * and makes the reversal a sign change rather than a special case.
 */

export type SimStop = {
  id: string;
  name: string;
  /** Order on the route, 1-based. */
  stopOrder: number;
  lat: number;
  lng: number;
};

export type SimSpeed = "walking" | "city" | "highway";

/**
 * Metres per second.
 *
 * City is 8.3 m/s (30 kph), which is roughly a real bus in city traffic. The
 * point of the simulator is that a parent watching the map sees something that
 * looks like the product working, so picking a speed no city bus drives would
 * make the demo subtly wrong.
 */
export const SPEED_MPS: Record<SimSpeed, number> = {
  walking: 1.4, // ~5 kph, for stepping through a route
  city: 8.3, // ~30 kph
  highway: 16.7, // ~60 kph
};

/** A route flattened to the one-dimensional line the bus actually drives. */
export type SimPath = {
  stops: SimStop[];
  /** Length of the whole route, metres. */
  lengthMeters: number;
  /**
   * Cumulative distance to each stop, same order as `stops`.
   *
   * Zero for the first stop and `lengthMeters` for the last. Computed once by
   * `buildPath` because the runner ticks every few seconds and re-walking the
   * polyline on each tick would be needless work.
   */
  offsetsMeters: number[];
};

export type SimState = {
  /** Distance travelled from the first stop. Always within 0..lengthMeters. */
  alongMeters: number;
  /** +1 outbound, -1 on the return leg. */
  direction: 1 | -1;
};

/**
 * How far the bus may travel in one tick after a long gap.
 *
 * The clamp is the important part. A process that was down for an hour, or a
 * laptop that was suspended, would otherwise move the bus kilometres in a single
 * step - and every watching parent would see it teleport across the map. Clamped,
 * the simulator resumes from where it was rather than fast-forwarding.
 */
export const MAX_CATCHUP_METERS = 200;

/**
 * Float slack, in metres, for distance arithmetic.
 *
 * Repeated haversine subtraction drifts by around 1e-13. Left alone, a bus that
 * should be sitting exactly on a stop ends up 1e-13 m past it, which shows up as
 * `progress: 1.2e-13` instead of `0` and swallows the arrival the caller is about
 * to announce.
 */
export const EPSILON_M = 1e-6;

/**
 * Order the stops and measure the route.
 *
 * Sorting by `stopOrder` first is what stops a bus driving the route backwards
 * because the database returned the rows in a different order - which is not a
 * hypothetical, since there is no index guaranteeing that ordering.
 */
export function buildPath(stops: readonly SimStop[]): SimPath {
  const ordered = [...stops].sort((a, b) => a.stopOrder - b.stopOrder);

  const offsets: number[] = [0];
  let total = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    total += haversineMeters(ordered[i]!, ordered[i + 1]!);
    offsets.push(total);
  }

  return { stops: ordered, lengthMeters: total, offsetsMeters: offsets };
}

/** Start at the first stop, heading outbound. */
export function initialState(): SimState {
  return { alongMeters: 0, direction: 1 };
}

/** Start at the far end, heading back. */
export function reverseState(path: SimPath): SimState {
  return { alongMeters: path.lengthMeters, direction: -1 };
}

/**
 * Advance by `meters` of travel, reversing at each end of the route.
 *
 * Reversal rather than wrapping, because that is what a bus does: it reaches the
 * terminus, turns around and comes back. Wrapping would have it jump from the
 * last stop to the first across open country.
 *
 * Returns the stops it arrived at. On the outbound leg the bus can pass several
 * stops in one tick if the tick is long, and the caller needs all of them, not
 * just the last, or it will announce a stop that was already behind it.
 */
export function advance(
  state: SimState,
  path: SimPath,
  meters: number,
): { state: SimState; arrivedAt: SimStop[] } {
  if (path.lengthMeters <= 0 || !Number.isFinite(meters) || meters <= 0) {
    return { state, arrivedAt: [] };
  }

  let along = state.alongMeters;
  let direction = state.direction;
  let remaining = meters;
  const arrivedAt: SimStop[] = [];

  /*
   * Bounded. Reversal can only happen twice - once at each end - so the real
   * limit is the number of stop crossings plus two. The cap is generous enough
   * that it never binds in normal use and small enough that a malformed path
   * cannot spin here. An unbounded loop in the server process is a far worse
   * failure than a simulated bus that stops short.
   */
  let guard = path.stops.length * 4 + 8;

  while (remaining > EPSILON_M && guard-- > 0) {
    /*
     * Step to the NEXT boundary, which is the next stop going in the current
     * direction - not the end of the route.
     *
     * Two earlier versions got this wrong. One stepped straight to the terminus,
     * so intermediate stops were never crossed and a bus drove the whole route in
     * a single tick announcing only the last stop. The other reversed direction at
     * every stop, so the bus bounced between the first two and never got past
     * them. Stepping stop-to-stop is what makes both the announcements and the
     * reversal come out right.
     */
    const target = nextOffset(path, along, direction);

    if (target === null) {
      // Already sitting at a terminus with nothing ahead. Turn around and retry.
      direction = direction === 1 ? -1 : 1;
      continue;
    }

    const distance = Math.abs(target - along);

    if (distance <= EPSILON_M) {
      // Exactly on the boundary. Consume it so it is announced, and step past it
      // by nothing - the next iteration picks up the following stop.
      const reached = stopAt(path, target);
      if (reached) arrivedAt.push(reached);

      // At a terminus the next boundary is behind us, so turn around.
      if (isTerminus(target, path)) {
        along = target;
        direction = direction === 1 ? -1 : 1;
      } else {
        // Nudge past the boundary so the loop makes progress. Without this, an
        // exact-boundary arrival sits at distance 0 from its own stop forever.
        along = target + direction * EPSILON_M;
      }
      continue;
    }

    if (remaining < distance) {
      along += remaining * direction;
      remaining = 0;
      break;
    }

    remaining -= distance;
    along = target;

    const reached = stopAt(path, target);
    if (reached) arrivedAt.push(reached);

    if (isTerminus(target, path)) {
      direction = direction === 1 ? -1 : 1;
    }
  }

  return {
    // Clamped, because the guard can exit with a few metres unspent and the bus
    // must never end up outside 0..lengthMeters.
    state: {
      alongMeters: clamp(along, 0, path.lengthMeters),
      direction,
    },
    arrivedAt,
  };
}

/** The stop exactly at `meters`, or null if that is between two stops. */
function stopAt(path: SimPath, meters: number): SimStop | null {
  for (let i = 0; i < path.stops.length; i++) {
    if (Math.abs(path.offsetsMeters[i]! - meters) < EPSILON_M) return path.stops[i]!;
  }
  return null;
}

/**
 * The offset of the next stop boundary ahead of `along` in the given direction.
 *
 * Null when there is nothing left that way, which happens only at a terminus.
 */
function nextOffset(path: SimPath, along: number, direction: 1 | -1): number | null {
  let best: number | null = null;

  for (const offset of path.offsetsMeters) {
    if (direction === 1) {
      if (offset > along + EPSILON_M && (best === null || offset < best)) best = offset;
    } else {
      if (offset < along - EPSILON_M && (best === null || offset > best)) best = offset;
    }
  }

  return best;
}

function isTerminus(offset: number, path: SimPath): boolean {
  return offset <= EPSILON_M || offset >= path.lengthMeters - EPSILON_M;
}

/** Where the bus is right now, and which way it is pointing. */
export function positionAt(
  state: SimState,
  path: SimPath,
): { lat: number; lng: number; headingDeg: number; alongMeters: number } | null {
  const { stops } = path;
  if (stops.length === 0) return null;

  const along = clamp(state.alongMeters, 0, path.lengthMeters);

  // A one-stop route has no line to interpolate along. Sit on the stop rather
  // than returning null, so the bus still appears on the map.
  if (stops.length === 1) {
    const only = stops[0]!;
    return { lat: only.lat, lng: only.lng, headingDeg: 0, alongMeters: along };
  }

  /*
   * Find the segment this distance falls in.
   *
   * The last stop is the end of the last segment, so the loop is bounded by
   * `length - 1` and the fallback handles being exactly at the terminus.
   */
  let i = 0;
  while (i < path.offsetsMeters.length - 2 && along > path.offsetsMeters[i + 1]!) {
    i += 1;
  }

  const from = stops[i]!;
  const to = stops[i + 1] ?? from;
  const startOffset = path.offsetsMeters[i] ?? 0;
  const endOffset = path.offsetsMeters[i + 1] ?? path.lengthMeters;
  const segmentLength = endOffset - startOffset;

  const t = segmentLength <= EPSILON_M ? 0 : clamp((along - startOffset) / segmentLength, 0, 1);
  const at = lerpLatLng(from, to, t);

  // Heading is the bearing to the stop ahead *in the direction of travel*, not
  // simply the bearing to the next stop - on the return leg those differ by 180
  // degrees, and a bus turning round with a fixed marker pointing the wrong way
  // is the sort of detail that undermines a demo.
  const heading = state.direction === 1 ? bearingDegrees(at, to) : bearingDegrees(at, from);

  return {
    lat: at.lat,
    lng: at.lng,
    headingDeg: (heading + 360) % 360,
    alongMeters: along,
  };
}

/**
 * The next stop ahead, for an ETA label. Null at the terminus in the direction of
 * travel.
 *
 * On the return leg this walks the offsets from the far end backwards. An earlier
 * version walked them forwards from index 0 and returned the *first* offset below
 * the bus, which on the way home is A - so a bus two stops from home would report
 * that the next stop was the one it had just left, four kilometres behind it.
 */
export function nextStop(
  state: SimState,
  path: SimPath,
): { stop: SimStop; remainingMeters: number } | null {
  const { stops, offsetsMeters, lengthMeters } = path;
  const along = clamp(state.alongMeters, 0, lengthMeters);

  const last = offsetsMeters.length - 1;

  if (state.direction === 1) {
    for (let i = 1; i <= last; i++) {
      const offset = offsetsMeters[i]!;
      if (offset > along + EPSILON_M) {
        return { stop: stops[i]!, remainingMeters: offset - along };
      }
    }
    return null;
  }

  for (let i = last - 1; i >= 0; i--) {
    const offset = offsetsMeters[i]!;
    if (offset < along - EPSILON_M) {
      return { stop: stops[i]!, remainingMeters: along - offset };
    }
  }
  return null;
}

/** `elapsedMs` of wall clock, converted to metres at `speed`. */
export function metersFor(elapsedMs: number, speed: SimSpeed): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const cappedMs = Math.min(elapsedMs, (MAX_CATCHUP_METERS / SPEED_MPS[speed]) * 1000);
  return (cappedMs / 1000) * SPEED_MPS[speed];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}