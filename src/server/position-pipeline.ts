/**
 * The one place a bus's position is accepted, published and recorded.
 *
 * Two very different callers report a position: a driver's phone over Socket.IO,
 * and a tracker fitted to the vehicle over HTTP. They must not be allowed to
 * drift apart. Both have to reject a replayed fix, count who is aboard, broadcast
 * to watchers, and - on a slower cadence - write the row and run the three
 * watchers that hang off the same stream. Re-implementing that in the route
 * handler would guarantee the two paths disagree within a release, and "the
 * hardware path behaves differently from the phone path" is a bug nobody would
 * think to look for.
 *
 * So the *policy* (how often to persist, whether the caller is even allowed to
 * report) stays with the caller, and the *pipeline* lives here. The simulated bus
 * deliberately does not use this: it has no `Trip`, no onboard count and a
 * different watcher set, and pretending otherwise would add branches to the hot
 * path for a feature that only ever runs in a demo.
 *
 * This file is plain Node - no `server-only` - because the custom server loads
 * it directly, exactly like `socket.ts`.
 */
import { prisma } from "@/lib/db";
import { classifyReportAge, type ReportAge } from "@/lib/tracking";
import type { BusLocationPayload } from "@/lib/socket-events";
import { pushBusLocation } from "./realtime-emit";
import { evaluateGeofence } from "./geofence-watcher";
import { evaluateDepartures } from "./boarding-watcher";
import { evaluateDriving } from "./driving-watcher";

export type PositionReport = {
  busId: string;
  lat: number;
  lng: number;
  speedKph: number | null;
  headingDeg: number | null;
  /**
   * Device clock when the fix was taken, epoch ms. Null means "no claim", which
   * is accepted; see `classifyReportAge`.
   */
  reportedAt?: number | null;
  /** Write to Postgres and run the watchers on this call, or just broadcast? */
  persist: boolean;
};

export type PositionOutcome =
  | { accepted: true }
  | { accepted: false; reason: ReportAge };

/**
 * Accept one position, if it is believable.
 *
 * Returns whether it was accepted rather than throwing, because both callers
 * treat a rejected fix as a normal event - a phone in a tunnel replays its whole
 * buffer on reconnect and most of those are stale by design.
 */
export async function applyPosition(report: PositionReport): Promise<PositionOutcome> {
  const age = classifyReportAge(report.reportedAt, Date.now());
  if (age !== "fresh") return { accepted: false, reason: age };

  const at = Date.now();

  // Who is aboard right now. Counted on every ping rather than only on persist,
  // because the number is cheap and a watcher watching the marker wants it live.
  const onboardCount = await prisma.pickupRecord.count({
    where: {
      trip: { busId: report.busId, status: "ONGOING" },
      status: "PICKED",
    },
  });

  const payload: BusLocationPayload = {
    busId: report.busId,
    lat: report.lat,
    lng: report.lng,
    speedKph: report.speedKph,
    headingDeg: report.headingDeg,
    onboardCount,
    // Server clock, deliberately: a parent's countdown must not depend on the
    // driver's phone clock, and `reportedAt` above was only used to judge age.
    at,
  };

  // Broadcast always, so the map stays smooth.
  pushBusLocation(payload);

  if (!report.persist) return { accepted: true };

  await prisma.bus.update({
    where: { id: report.busId },
    data: {
      currentLat: report.lat,
      currentLng: report.lng,
      speedKph: report.speedKph,
      headingDeg: report.headingDeg,
      lastLocationAt: new Date(at),
      onboardCount,
    },
  });

  /*
   * The watchers, fire-and-forget.
   *
   * Three questions the same stream answers - is the bus approaching somebody's
   * stop, has it left a stop it served, how is it being driven - all keyed on the
   * run the bus is on. They are for somebody else's phone, so looking up the trip
   * must not add round trips to the report itself, which is why this is not
   * awaited. Called after the persist so it rides the same throttled cadence.
   */
  void runTripWatchers(report, at);

  return { accepted: true };
}

/**
 * Look up the run this bus is on and hand the position to the three watchers.
 *
 * Split out so it reads as one idea, and so the ordering - geofence, then
 * departure, then driving - sits in one place. `evaluateGeofence` is awaited
 * because it is the oldest and by far the most common of the three; the other
 * two are `void`ed, exactly as they were when this lived inside the socket
 * handler.
 */
async function runTripWatchers(report: PositionReport, at: number): Promise<void> {
  const trip = await prisma.trip.findFirst({
    where: { busId: report.busId, status: "ONGOING" },
    orderBy: { startedAt: "desc" },
    select: { id: true, direction: true, driverId: true },
  });
  if (!trip) return;

  const position = { lat: report.lat, lng: report.lng };

  await evaluateGeofence({
    busId: report.busId,
    position,
    direction: trip.direction,
    tripId: trip.id,
  });

  void evaluateDepartures({
    busId: report.busId,
    position,
    direction: trip.direction,
    tripId: trip.id,
  });

  /*
   * A fix with no speed is skipped rather than read as zero: a device that did
   * not report a speed has not braked, and treating the missing reading as a stop
   * would score every GPS dropout as an emergency stop.
   */
  if (report.speedKph != null) {
    void evaluateDriving({
      busId: report.busId,
      driverId: trip.driverId,
      tripId: trip.id,
      fix: { lat: report.lat, lng: report.lng, speedKph: report.speedKph, at },
    });
  }
}
