/**
 * The boarding watcher: "the bus left without your child."
 *
 * Split from `src/lib/boarding.ts` for the same reason the geofence rings are:
 * the decision about *which* stop has just been left is pure and unit tested,
 * and this file owns the reading, the writing and the notifying, none of which
 * can be tested without a database and a bus that has actually moved away.
 *
 * WHERE IT SITS
 *
 * The geofence watcher fires on a bus drawing *near*; this one fires on a bus
 * that drew near and then *went*. Both run off the same 15-second position
 * stream, and both claim their once-per-run right the same way — a row in
 * `StopApproach` with a third ring value, "DEPARTED" — so a deploy mid-run, or
 * a process restart, can never tell a family twice.
 *
 * REAL TRIPS ONLY, AND WHY THAT IS NOT A LIMITATION
 *
 * Nothing here runs for a simulated bus. The simulator moves without a `Trip`
 * row precisely so a demonstration never writes fake attendance history into
 * real reports, and a child left behind is a fact about attendance. A bus with
 * no roster has nobody to be marked missed, so a departure it reports is noise
 * by definition.
 *
 * NEVER THROWS
 *
 * Same contract as the geofence watcher. A safety alert layered on top of a
 * tracking system that is still working must not unwind the driver's location
 * ping when it fails; failures are logged and swallowed.
 */

import { prisma } from "@/lib/db";
import { PickupStatus } from "@/generated/prisma/enums";
import { notifyMany } from "@/lib/notifications";
import { departureOutcome, newlyDeparted, type BoardingStatus, type BoardingStop, type DepartureDecision, DEPARTED_METERS } from "@/lib/boarding";
import { geofenceDateKey } from "@/lib/geofence";
import { isUniqueViolation, type GeofenceDirection } from "./geofence-watcher";
import type { LatLng } from "@/lib/geo";

export type DepartureInput = {
  busId: string;
  position: LatLng;
  direction: GeofenceDirection;
  tripId: string;
  /** The bus's stops, when the caller already has them. */
  stops?: readonly BoardingStop[];
};

/** What the caller already knows about the run the departure belongs to. */
export type DepartureTrip = {
  busNumber: string | null;
  driverName: string | null;
};

/**
 * Report whatever stops this run has just left, and act on them.
 *
 * Callers: the driver's location handler, next to `evaluateGeofence`, on the
 * same throttled cadence — a departure needs to be right to within a stop, and
 * at city speed that takes minutes, not seconds.
 */
export async function evaluateDepartures(input: DepartureInput): Promise<void> {
  try {
    const now = new Date();
    const date = geofenceDateKey(now);

    /*
     * Every ring this bus has claimed today, for this direction, in one query.
     *
     * `arrived` is what makes a departure claimable — a stop nobody has stood
     * near cannot have been left — and `departed` is the once-per-run memo. The
     * read happens before the distance arithmetic, so the ticks where nothing
     * has been served yet pay for one indexed query and nothing else.
     */
    const rows = await prisma.stopApproach.findMany({
      where: { busId: input.busId, direction: input.direction, date: new Date(`${date}T00:00:00`) },
      select: { stopId: true, ring: true },
    });
    const arrived = new Set(rows.filter((r) => r.ring === "ARRIVING").map((r) => r.stopId));
    const departed = new Set(rows.filter((r) => r.ring === "DEPARTED").map((r) => r.stopId));

    // Cheap exit: nothing has been served yet, so nothing can have been left.
    if (arrived.size === 0) return;

    const stops = input.stops ?? (await loadStops(input.busId));
    if (stops.length === 0) return;

    const decisions = newlyDeparted({
      position: input.position,
      stops,
      arrived,
      departed,
    });
    if (decisions.length === 0) return;

    // One fetch of the run's identity, shared by every stop's message.
    const trip = await prisma.trip.findUnique({
      where: { id: input.tripId },
      select: {
        id: true,
        bus: { select: { busNumber: true } },
        driver: { select: { name: true, phone: true } },
      },
    });
    if (!trip) return;

    // Sequential, matching the geofence fan-out: the claim is what keeps an
    // alert once-per-run, and two stops writing concurrently would race for it.
    for (const decision of decisions) {
      const claimed = await claimDeparture(input, decision, now, date);
      if (!claimed) continue;
      await resolveAndNotify(input.tripId, decision, {
        busNumber: trip.bus.busNumber,
        driverName: trip.driver.name,
        driverPhone: trip.driver.phone,
      });
    }
  } catch (error) {
    console.error("[boarding] evaluation failed:", error);
  }
}

/**
 * Write the DEPARTED ring. Returns false when another tick already reported it.
 *
 * Same argument as `claimRing`: the claim is taken *before* the attendance
 * write, because a crash between the two costs one missed alert — while the
 * reverse order would leave a family told twice.
 */
async function claimDeparture(
  input: DepartureInput,
  decision: DepartureDecision,
  now: Date,
  date: string,
): Promise<boolean> {
  try {
    await prisma.stopApproach.create({
      data: {
        busId: input.busId,
        stopId: decision.stopId,
        tripId: input.tripId,
        direction: input.direction,
        ring: "DEPARTED",
        radiusMeters: DEPARTED_METERS,
        notifiedAt: now,
        date: new Date(`${date}T00:00:00`),
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** The run's identity, for the body of the message a guardian reads. */
type TripIdentity = {
  busNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
};

/**
 * Settle the roster at this stop, and raise the alarm where it is warranted.
 *
 * The two resolutions are deliberately separate writes. A student who pressed
 * "I'm waiting" and was left behind is a safety incident and goes to their
 * guardians; a student who never showed up is attendance bookkeeping and goes
 * to nobody. Folding them into one message would either alarm every family for
 * a normal absence, or bury the real incident under a queue of normal ones.
 */
async function resolveAndNotify(
  tripId: string,
  decision: DepartureDecision,
  trip: TripIdentity,
): Promise<void> {
  const records = await prisma.pickupRecord.findMany({
    where: { tripId, stopId: decision.stopId },
    select: {
      id: true,
      status: true,
      student: {
        select: {
          user: { select: { id: true, name: true } },
          guardians: { select: { parent: { select: { userId: true } } } },
        },
      },
    },
  });

  const missed = records.filter((r) => departureOutcome(r.status as BoardingStatus) === "MISSED");
  const absent = records.filter((r) => departureOutcome(r.status as BoardingStatus) === "ABSENT");

  // Idempotent by status: `departureOutcome` refuses an already-resolved record,
  // so a racing tick that reaches here twice finds nothing left to change.
  if (absent.length > 0) {
    await prisma.pickupRecord.updateMany({
      where: { id: { in: absent.map((r) => r.id) } },
      data: { status: PickupStatus.ABSENT },
    });
  }
  if (missed.length > 0) {
    await prisma.pickupRecord.updateMany({
      where: { id: { in: missed.map((r) => r.id) } },
      data: { status: PickupStatus.MISSED },
    });
  }

  // Nobody was left behind. The statuses above still stand: an unmarked
  // attendance row is a fact about the run, not about anybody's phone.
  if (missed.length === 0) return;

  const busLabel = trip.busNumber ?? "The bus";
  const contact = [
    trip.driverName && trip.driverPhone ? `Call ${trip.driverName} on ${trip.driverPhone}.` : null,
    trip.driverName && !trip.driverPhone ? `Contact ${trip.driverName} through the college office.` : null,
  ].filter(Boolean)[0];

  const inputs = missed.flatMap((record) => {
    const first = record.student.user.name.split(" ")[0] || "Your child";
    const body =
      `${first} was waiting at ${decision.stopName} and ${busLabel} has left. ` +
      `They are still at the stop. ` +
      (contact ?? "Contact the college office.");
    return [
      ...record.student.guardians.map((guardian) => ({
        userId: guardian.parent.userId,
        type: "NO_SHOW" as const,
        title: "The bus left without your child",
        body,
        href: "/parent",
      })),
      {
        userId: record.student.user.id,
        type: "NO_SHOW" as const,
        title: "Your bus left without you",
        body: `${busLabel} left ${decision.stopName} without you. You can still board at a later stop — the map shows where it is.`,
        href: "/student",
      },
    ];
  });

  await notifyMany(inputs);
}

/** The bus's stops in route order, for a caller that does not already hold them. */
async function loadStops(busId: string): Promise<BoardingStop[]> {
  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: {
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

  return bus?.route?.routeStops.map((rs) => rs.stop) ?? [];
}
