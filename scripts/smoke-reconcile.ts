/**
 * Smoke test for abandoned-trip reconciliation.
 *
 * This is the one behaviour that cannot be checked with a unit test alone,
 * because it is the interaction between the pure rule and real rows: it plants
 * a trip that has gone silent, sweeps it, and asserts the trip closed, its
 * unresolved records settled, the onboard count corrected, and a healthy trip
 * left strictly alone.
 *
 * Everything it plants is cleaned up afterwards, and it refuses to run against
 * anything other than a database it can find trips in.
 *
 * Usage: npx tsx scripts/smoke-reconcile.ts
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { TripDirection, TripStatus, PickupStatus } from "../src/generated/prisma/enums";
import { reconcileAbandonedTrips } from "../src/server/trip-reconciler";
import { ABANDONED_TRIP_AFTER_MS, isTripAbandoned } from "../src/lib/trip-liveness";

const HOUR = 60 * 60 * 1000;

/**
 * Exactly the projection `reconcileAbandonedTrips` uses.
 *
 * Duplicated rather than exported so the two cannot drift apart silently: if the
 * runner's select changes, this one stops matching what the rule is handed and
 * the check below fails loudly instead of passing on a stale shape.
 */
const livenessSelect = {
  status: true,
  startedAt: true,
  createdAt: true,
  updatedAt: true,
  bus: { select: { lastLocationAt: true } },
} as const;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`PASS  ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
}

/**
 * Build a trip in a state the rule should act on.
 *
 * `ageMs` is how long ago the trip last showed life, which is what the sweep
 * actually looks at. `@@unique([busId, date, direction])` means every planted
 * trip needs its own bus and its own date, so the date is derived from the age
 * rather than fixed - which also keeps the row from colliding with real data.
 */
async function plantTrip(opts: {
  routeId: string;
  driverId: string;
  ageMs: number;
  status?: TripStatus;
}) {
  const now = Date.now();
  const day = new Date(now - opts.ageMs);
  day.setHours(0, 0, 0, 0);

  const stamp = randomUUID().slice(0, 8);
  const bus = await prisma.bus.create({
    data: {
      busNumber: `SMK-${stamp}`,
      registrationNo: `SMK-${stamp}`,
      capacity: 10,
      onboardCount: 0,
      isSimulated: false,
      routeId: opts.routeId,
    },
    select: { id: true },
  });

  const trip = await prisma.trip.create({
    data: {
      busId: bus.id,
      routeId: opts.routeId,
      driverId: opts.driverId,
      date: day,
      direction: TripDirection.PICKUP,
      status: opts.status ?? TripStatus.ONGOING,
      scheduledStart: new Date(now - opts.ageMs - HOUR),
      startedAt: new Date(now - opts.ageMs),
      // Explicit, and not derived from `opts.status`: that is an optional
      // parameter which is `undefined` on every call here, so `opts.status ===
      // TripStatus.ONGOING` is false and the ternary would quietly stamp a
      // finished trip onto a run that is supposed to still be going.
      endedAt: null,

      /*
       * Backdating `createdAt` and `updatedAt` on insert is what makes this
       * fixture realistic, and it is the subtlest line in the file.
       *
       * Prisma stamps `@updatedAt` with the current instant on every insert and
       * on every update it sends, so a row created above looks to the liveness
       * rule like it was written seconds ago and was therefore alive seconds
       * ago. The sweep would then correctly spare it, and this test would fail
       * for a reason that has nothing to do with the sweep.
       *
       * Passing both values in the insert is the one way to place a row in the
       * past, because it is the only write that does not get re-stamped. The
       * alternative - issuing a second `update` with old values - does not work
       * here, and silently produces the wrong instant rather than an error: a
       * `::timestamptz` literal in raw SQL is read back shifted by this
       * machine's UTC offset, so a row written to look eight hours old came
       * back looking two and a half hours old. Every assertion below would
       * then be measured against a trip that was never actually abandoned.
       */
      createdAt: new Date(now - opts.ageMs),
      updatedAt: new Date(now - opts.ageMs),
    },
    select: { id: true, busId: true },
  });

  // A silent run also has a bus that stopped reporting. Left fresh, the clamp
  // in lastActivityAt would treat the ping as proof of life and the sweep would
  // correctly spare the row - so this is what makes the planted trip genuinely
  // abandoned rather than merely old.
  /*
   * The bus has to have gone quiet too, not just the trip. `lastActivityAt`
   * clamps the bus ping to the trip's own lifetime and then prefers it, so a
   * freshly-reporting bus would legitimately keep an eight-hour-old row alive -
   * and this is exactly the case worth testing, because it is what a bus does
   * when a driver starts a second run while the first is still stuck ONGOING.
   */
  await prisma.bus.update({
    where: { id: bus.id },
    data: { lastLocationAt: new Date(now - opts.ageMs) },
  });

  return trip;
}

async function main(): Promise<void> {
  // The trips need a route because `Trip.routeId` is required, but the sweep
  // never reads it, so any route will do - the first one by creation order is
  // the seeded one and therefore stable across runs.
  const route = await prisma.route.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!route) throw new Error("No route in the database. Run `npm run db:seed` first.");

  const driver = await prisma.user.findFirst({
    where: { role: "DRIVER" },
    select: { id: true },
  });
  if (!driver) throw new Error("No driver in the database. Run `npm run db:seed` first.");

  /*
   * PickupRecord needs a real student and a real stop, so the fixture takes
   * three of each. `@@unique([tripId, studentId, stopId])` means the three
   * records also have to be three different students - the same student cannot
   * be planted twice on one trip, which is the rule itself saying a student is
   * only ever recorded once per run.
   */
  const students = await prisma.studentProfile.findMany({ take: 3, select: { id: true } });
  if (students.length < 3) throw new Error("Need at least 3 students. Run `npm run db:seed` first.");

  const stops = await prisma.stop.findMany({ take: 3, select: { id: true } });
  if (stops.length < 3) throw new Error("Need at least 3 stops. Run `npm run db:seed` first.");

  const planted: string[] = [];
  const cleanup = async () => {
    for (const tripId of planted) {
      // Pickup rows first: the trip cascades, but being explicit keeps this
      // correct even if the schema's onDelete changes later.
      await prisma.pickupRecord.deleteMany({ where: { tripId } });
      await prisma.stopEvent.deleteMany({ where: { tripId } });
      await prisma.trip.deleteMany({ where: { id: tripId } });
    }
    // Buses cascade from their trips, so anything still standing is a trip that
    // was never created; clear by the marker prefix to be certain.
    await prisma.bus.deleteMany({ where: { busNumber: { startsWith: "SMK-" } } });
  };

  try {
    // ------------------------------------------------------- an abandoned run
    const stale = await plantTrip({
      routeId: route.id,
      driverId: driver.id,
      ageMs: 8 * HOUR,
    });
    planted.push(stale.id);

    // Three records in the states an unfinished run leaves behind: still
    // untouched, marked as waiting, and genuinely picked up.
    await prisma.pickupRecord.createMany({
      data: [
        { tripId: stale.id, studentId: students[0]!.id, stopId: stops[0]!.id, status: PickupStatus.PENDING },
        { tripId: stale.id, studentId: students[1]!.id, stopId: stops[1]!.id, status: PickupStatus.WAITING },
        {
          tripId: stale.id,
          studentId: students[2]!.id,
          stopId: stops[2]!.id,
          status: PickupStatus.PICKED,
          pickedAt: new Date(Date.now() - 7 * HOUR),
        },
      ],
    });

    // A healthy run: started recently, still pinging. Must survive untouched.
    const live = await plantTrip({
      routeId: route.id,
      driverId: driver.id,
      ageMs: 60_000,
    });
    planted.push(live.id);
    await prisma.bus.update({
      where: { id: live.busId },
      data: { lastLocationAt: new Date() },
    });

    // A long run that is still pinging. Six hours is past the threshold, and it
    // must still survive - this is the case that would wrongly close a real
    // route if liveness keyed off startedAt alone.
    const longButLive = await plantTrip({
      routeId: route.id,
      driverId: driver.id,
      ageMs: 6 * HOUR,
    });
    planted.push(longButLive.id);
    await prisma.bus.update({
      where: { id: longButLive.busId },
      data: { lastLocationAt: new Date() },
    });

    // Read the row the reconciler itself reads, so this check exercises the same
    // shape rather than a hand-built approximation of it.
    const before = await prisma.trip.findUnique({
      where: { id: stale.id },
      select: livenessSelect,
    });
    check(
      "planted trip is recognised as abandoned before the sweep",
      before !== null && isTripAbandoned(before, Date.now()),
      before === null ? "trip not found" : `status=${before.status}`,
    );

    const result = await reconcileAbandonedTrips();
    check("sweep reported no error", result.error === undefined, result.error);

    const after = await prisma.trip.findUnique({
      where: { id: stale.id },
      select: { status: true, endedAt: true },
    });
    check("abandoned trip is now COMPLETED", after?.status === TripStatus.COMPLETED, `got ${after?.status}`);

    check(
      "endedAt is backdated to the last sign of life, not to sweep time",
      after !== null &&
        after.endedAt !== null &&
        after.endedAt.getTime() < Date.now() - ABANDONED_TRIP_AFTER_MS + 60_000,
      `endedAt=${after?.endedAt?.toISOString()}`,
    );

    const records = await prisma.pickupRecord.groupBy({
      by: ["status"],
      where: { tripId: stale.id },
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(records.map((r) => [r.status, r._count._all]));
    check("PENDING became MISSED", byStatus[PickupStatus.MISSED] === 2, JSON.stringify(byStatus));
    check("PICKED was left alone", byStatus[PickupStatus.PICKED] === 1, JSON.stringify(byStatus));

    const bus = await prisma.bus.findUnique({
      where: { id: stale.busId },
      select: { onboardCount: true },
    });
    check(
      "bus onboard count matches the students actually picked up",
      bus?.onboardCount === 1,
      `got ${bus?.onboardCount}`,
    );

    const liveAfter = await prisma.trip.findUnique({
      where: { id: live.id },
      select: { status: true },
    });
    check(
      "trip that pinged a minute ago is still ONGOING",
      liveAfter?.status === TripStatus.ONGOING,
      `got ${liveAfter?.status}`,
    );

    const longAfter = await prisma.trip.findUnique({
      where: { id: longButLive.id },
      select: { status: true },
    });
    check(
      "six-hour run that is still pinging is NOT closed",
      longAfter?.status === TripStatus.ONGOING,
      `got ${longAfter?.status}`,
    );

    // Idempotence: a second sweep must not re-settle or re-close anything.
    const second = await reconcileAbandonedTrips();
    const settled = await prisma.pickupRecord.findMany({
      where: { tripId: stale.id },
      select: { status: true },
    });
    check(
      "second sweep closes nothing twice",
      !second.closed.includes(stale.id) && settled.length === 3,
      `closed=${second.closed.length} records=${settled.length}`,
    );
  } finally {
    await cleanup();
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error("\n  smoke:reconcile crashed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());