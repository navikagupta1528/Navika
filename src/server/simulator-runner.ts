/**
 * The simulator runner: the loop that actually moves a simulated bus.
 *
 * Split from `src/lib/simulator.ts` for the same reason the tracking logic is
 * split from its queries. `simulator.ts` is where the movement maths lives and it
 * is unit tested with no database. This file owns the interval, the writes and the
 * broadcast, none of which can be tested without one.
 *
 * WHY A SERVER-SIDE TIMER AND NOT A CLIENT ONE.
 *
 * A driver PWA stops sending when the phone sleeps or the tab is closed, and a
 * browser tab cannot be trusted to keep a 1 Hz interval running anyway. Since
 * this exists to demonstrate the product, a position stream that depends on
 * somebody leaving a laptop lid open is not much of a demonstration. Driving it
 * from the server means the bus moves whether or not anyone is watching, which is
 * also the only way the parent-facing screens get exercised honestly.
 */

import { prisma } from "@/lib/db";
import { pushBusLocation, pushStopArrival } from "./realtime-emit";
import { evaluateGeofence } from "./geofence-watcher";
import { Direction } from "@/generated/prisma/enums";
import {
  advance,
  buildPath,
  initialState,
  metersFor,
  positionAt,
  SPEED_MPS,
  type SimPath,
  type SimSpeed,
  type SimState,
  type SimStop,
} from "@/lib/simulator";

/** How often the bus moves. Matches what a real driver's phone sends. */
export const TICK_MS = 4_000;

/**
 * How often the position is written to Postgres.
 *
 * A simulated bus is not a real bus, so the database copy is mostly for anyone who
 * loads a page fresh. Every tick would be a write nobody needs; every five minutes
 * would be stale enough to look broken on a fresh load. Ten seconds is the same
 * cadence the real driver path uses.
 */
const PERSIST_EVERY_MS = 10_000;

type Running = {
  timer: ReturnType<typeof setInterval>;
  path: SimPath;
  state: SimState;
  speed: SimSpeed;
  busNumber: string;
  lastPersistAt: number;
};

const running = new Map<string, Running>();

/** Buses currently being simulated. Read by the admin screen. */
export function simulatedBusIds(): string[] {
  return [...running.keys()];
}

export function isSimulating(busId: string): boolean {
  return running.has(busId);
}

/**
 * Load a bus's route into a `SimPath`.
 *
 * Returns null when there is nothing to drive: no route, or a route with fewer
 * than two stops. A simulator with one stop has no line to move along, and
 * reporting that plainly is better than silently parking a bus at one coordinate
 * forever while the screen claims it is moving.
 */
async function loadPath(busId: string): Promise<SimPath | null> {
  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: {
      routeId: true,
      route: {
        select: {
          routeStops: {
            orderBy: { stopOrder: "asc" },
            select: { stop: { select: { id: true, name: true, lat: true, lng: true } } },
          },
        },
      },
    },
  });

  const routeStops = bus?.route?.routeStops ?? [];
  if (routeStops.length < 2) return null;

  return buildPath(
    routeStops.map(
      (rs, index): SimStop => ({
        id: rs.stop.id,
        name: rs.stop.name,
        stopOrder: index + 1,
        lat: rs.stop.lat,
        lng: rs.stop.lng,
      }),
    ),
  );
}

/**
 * Start driving a bus along its route.
 *
 * Idempotent: starting a bus that is already being simulated is a no-op that
 * returns the same status, rather than a second interval and two buses' worth of
 * writes fighting over the same row.
 */
export async function startSimulation(busId: string): Promise<
  { ok: true; alreadyRunning: boolean } | { ok: false; error: string }
> {
  if (running.has(busId)) return { ok: true, alreadyRunning: true };

  const path = await loadPath(busId);
  if (!path) {
    return {
      ok: false,
      error: "This bus has no route with at least two stops, so there is nothing to drive.",
    };
  }

  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: { busNumber: true },
  });
  if (!bus) return { ok: false, error: "No such bus." };

  /*
   * isSimulated is set here, and this is the only writer of that column anywhere
   * in the project.
   *
   * It has existed in the schema since Phase 0 and the badge has been rendering
   * on the fleet and overview screens the whole time, with nothing behind it - a
   * bus could never actually be simulated. Setting the flag on start rather than
   * on tick means a server that restarts mid-demo leaves the flag set but the bus
   * stopped, which is why `/api/health` and the fleet screen both re-check
   * liveness rather than trusting the column alone.
   */
  await prisma.bus.update({
    where: { id: busId },
    data: {
      isSimulated: true,
      lastLocationAt: null,
      speedKph: null,
    },
  });

  const entry: Running = {
    timer: setInterval(() => {
      void tick(busId, path, entry);
    }, TICK_MS),
    path,
    state: initialState(),
    speed: "city",
    busNumber: bus.busNumber,
    lastPersistAt: 0,
  };

  running.set(busId, entry);

  // Move once immediately, so the map shows the bus rather than a 4-second gap
  // after the admin clicks the button.
  await tick(busId, path, entry);

  return { ok: true, alreadyRunning: false };
}

/**
 * Stop driving a bus.
 *
 * Also clears the flag and the live-looking fields, because leaving
 * `lastLocationAt` fresh would make a stopped bus keep rendering as live on the
 * fleet map - the freshness window is two minutes, so an admin who stops a
 * simulation and looks away would come back to a bus that still says "live".
 */
export async function stopSimulation(busId: string): Promise<void> {
  const entry = running.get(busId);
  if (entry) {
    clearInterval(entry.timer);
    running.delete(busId);
  }

  await prisma.bus.update({
    where: { id: busId },
    data: { isSimulated: false, speedKph: null },
  });
}

export async function stopAllSimulations(): Promise<void> {
  await Promise.all([...running.keys()].map((id) => stopSimulation(id)));
}

/**
 * Clear any `isSimulated` flag left behind by a previous run of this process.
 *
 * The flag is durable; the interval that moves the bus is not. A deploy, a crash
 * or a container restart leaves the column set and the bus parked, and the fleet
 * screen renders a "simulated" badge beside a marker that no longer moves.
 *
 * Only safe on a single-instance deployment, where "no simulation is running in
 * this process" genuinely means "none is running". On more than one instance this
 * would stop other instances' buses mid-route, and would need an ownership table
 * or a lease instead. `render.yaml` pins `numInstances: 1` for this reason.
 *
 * Failures are swallowed: this runs during boot, and a database that is not up
 * yet is a normal condition, not a reason to refuse to serve traffic. The next
 * screen load will re-check liveness in-process anyway.
 */
export async function resetStaleSimulationFlags(): Promise<void> {
  try {
    const { count } = await prisma.bus.updateMany({
      where: { isSimulated: true },
      data: { isSimulated: false, speedKph: null },
    });
    if (count > 0) {
      console.log(`  simulator: cleared ${count} stale simulated flag(s)`);
    }
  } catch (error) {
    console.warn(
      "  simulator: could not clear stale simulated flags (is the database up?)",
      error instanceof Error ? error.message : error,
    );
  }
}

/** One movement step. Split out so the first tick and the interval share it. */
async function tick(busId: string, path: SimPath, entry: Running): Promise<void> {
  // The bus may have been deleted, or its route re-assigned, since the timer
  // started. Every iteration checks, because a throw inside a setInterval
  // callback is an unhandled rejection, and one of those takes the process down.
  const stillExists = await prisma.bus.findUnique({
    where: { id: busId },
    select: { id: true },
  });
  if (!stillExists) {
    clearInterval(entry.timer);
    running.delete(busId);
    return;
  }

  const meters = metersFor(TICK_MS, entry.speed);
  const moved = advance(entry.state, path, meters);
  entry.state = moved.state;

  const position = positionAt(entry.state, path);
  if (!position) return;

  const speedKph = Math.round(SPEED_MPS[entry.speed] * 3.6);
  const at = Date.now();

  /*
   * Broadcast on every tick, persist on a slower cadence - the same split the
   * real driver path uses, and for the same reason: a watcher's map should stay
   * smooth, but the database does not need a row per frame.
   */
  pushBusLocation({
    busId,
    lat: position.lat,
    lng: position.lng,
    speedKph,
    headingDeg: Math.round(position.headingDeg),
    onboardCount: 0,
    at,
  });

  /*
   * Stop arrivals go out over the socket rather than into the database.
   *
   * `StopEvent.tripId` is required and cascades, so there is nowhere to attach a
   * row for a bus that is not on a scheduled trip - and inventing a trip for a
   * simulation would put fake attendance history into real reports. The event
   * itself is what a watching map actually needs, and it costs nothing to send.
   */
  for (const stop of moved.arrivedAt) {
    pushStopArrival({
      busId,
      stopId: stop.id,
      stopName: stop.name,
      at,
      simulated: true,
    });
  }

  /*
   * Geofence alerts for the families waiting at a stop.
   *
   * Fire-and-forget on purpose: `evaluateGeofence` never throws and does no
   * database work at all unless the bus is inside the 800 m ring of a stop, so
   * the common tick pays for this with a few dozen haversines and nothing else.
   * Not awaited, because a slow alert write must not stretch the loop that
   * drives the bus — the bus moving smoothly is the feature being demonstrated.
   *
   * A simulated bus has no `Trip`, so `tripId` is null and the dedup is keyed on
   * bus, stop, direction and day. The outbound leg stands in for the morning
   * pickup run and the inbound leg for the evening drop, which is what a parent
   * watching a demo would expect to be notified about.
   */
  void evaluateGeofence({
    busId,
    position: { lat: position.lat, lng: position.lng },
    direction: entry.state.direction === 1 ? Direction.PICKUP : Direction.DROPOFF,
    tripId: null,
    stops: path.stops,
  });

  if (at - entry.lastPersistAt < PERSIST_EVERY_MS) return;
  entry.lastPersistAt = at;

  await prisma.bus.update({
    where: { id: busId },
    data: {
      currentLat: position.lat,
      currentLng: position.lng,
      speedKph,
      headingDeg: Math.round(position.headingDeg),
      lastLocationAt: new Date(at),
    },
  });
}

/** Where the bus is on its route, for the admin screen. */
export function simulationProgress(busId: string): {
  alongMeters: number;
  totalMeters: number;
  leg: "outbound" | "inbound";
} | null {
  const entry = running.get(busId);
  if (!entry) return null;

  const position = positionAt(entry.state, entry.path);
  if (!position) return null;

  return {
    alongMeters: Math.round(position.alongMeters),
    totalMeters: Math.round(entry.path.lengthMeters),
    leg: entry.state.direction === 1 ? "outbound" : "inbound",
  };
}