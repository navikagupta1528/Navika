/**
 * Delay smoke test: "your bus is running late."
 *
 *   npm run smoke:delay
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
 *
 * The arithmetic — how late is the bus against a stop's schedule — is pure and
 * covered by `src/lib/delay.test.ts`. What that cannot check is the part that
 * fails in production: that the DELAY ring is claimed before the notification,
 * that the delay reaches the guardians of the students at *that* stop, and that
 * the arrival message itself carries the delay.
 *
 * It runs the same `evaluateGeofence` the driver's socket path calls, against
 * the live cluster, and rolls back everything it wrote.
 *
 *   npm run db:start          # if the machine has rebooted
 *   npm run smoke:delay
 */
import "dotenv/config";

// The app's own client, not a private second pool: `evaluateGeofence` reaches
// `notify()` through `src/lib/db`, so two pools in one process could together
// exhaust the cluster's connection limit and drop an alert no check observes.
// See `smoke-boarding.ts` for the full account. Same reasoning, same fix as
// `smoke-reconcile`.
import { prisma } from "../src/lib/db";
import { NotificationType, PickupStatus, Role, TripStatus } from "../src/generated/prisma/enums";
import { evaluateGeofence } from "../src/server/geofence-watcher";
import { geofenceDateKey } from "../src/lib/geofence";

let pass = 0;
let fail = 0;

function report(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type Stop = { id: string; name: string; lat: number; lng: number };

async function main() {
  console.log("\nDelay smoke test\n");

  // Pick the bus by the property this test needs — a route of at least two
  // stops and an active enrolment at one of them whose student has a guardian.
  const candidates = await prisma.bus.findMany({
    where: { routeId: { not: null } },
    orderBy: { busNumber: "asc" },
    select: {
      id: true,
      busNumber: true,
      routeId: true,
      route: {
        select: {
          routeStops: {
            orderBy: { stopOrder: "asc" },
            select: {
              scheduledHHMM: true,
              stop: { select: { id: true, name: true, lat: true, lng: true } },
            },
          },
        },
      },
    },
  });

  let bus: (typeof candidates)[number] | null = null;
  let chosen: {
    stop: Stop;
    direction: "PICKUP" | "DROPOFF";
    guardianIds: string[];
    guardianProfileIds: string[];
  } | null = null;

  for (const candidate of candidates) {
    if (!candidate.route || candidate.route.routeStops.length < 2) continue;
    const routeStops = candidate.route.routeStops.map((rs) => rs.stop);

    for (const stop of routeStops) {
      const enrollment = await prisma.enrollment.findFirst({
        where: { busId: candidate.id, stopId: stop.id, isActive: true },
        orderBy: { id: "asc" },
        select: {
          direction: true,
          student: {
            select: {
              guardians: { select: { parent: { select: { id: true, userId: true } } } },
            },
          },
        },
      });
      if (!enrollment) continue;

      const guardianIds = enrollment.student.guardians.map((g) => g.parent.userId);
      if (guardianIds.length === 0) continue;

      bus = candidate;
      chosen = {
        stop,
        direction: enrollment.direction,
        guardianIds,
        guardianProfileIds: enrollment.student.guardians.map((g) => g.parent.id),
      };
      break;
    }

    if (chosen) break;
  }

  if (!bus || !chosen) {
    console.error(
      "  No bus on a route of at least two stops with a guardian-backed enrolment. Run `npm run db:seed` first.",
    );
    process.exit(2);
  }

  const { stop, direction, guardianIds, guardianProfileIds } = chosen;
  const date = geofenceDateKey(new Date());
  const dayStart = new Date(`${date}T00:00:00`);

  console.log(
    `  bus ${bus.busNumber} · stop ${stop.name} · ${direction} · ${guardianIds.length} guardian(s)\n`,
  );

  // --- Fixtures ---------------------------------------------------------------
  // A stop scheduled for thirty minutes ago, so the bus is unambiguously late
  // when it arrives now. The original schedule is restored on the way out.
  const routeStop = await prisma.routeStop.findFirst({
    where: { routeId: bus.routeId!, stopId: stop.id },
    select: { id: true, scheduledHHMM: true },
  });
  const originalSchedule = routeStop?.scheduledHHMM ?? null;

  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);
  const scheduledHHMM = `${`${thirtyMinAgo.getHours()}`.padStart(2, "0")}:${`${thirtyMinAgo.getMinutes()}`.padStart(2, "0")}`;
  if (routeStop) {
    await prisma.routeStop.update({
      where: { id: routeStop.id },
      data: { scheduledHHMM },
    });
  }

  const driver = await prisma.user.findFirst({
    where: { role: Role.DRIVER, isActive: true },
    select: { id: true },
  });
  if (!driver) {
    console.error("  No active driver to run the trip. Run `npm run db:seed` first.");
    process.exit(2);
  }

  const tag = `smoke-delay-${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@test.local`,
      passwordHash: "x",
      name: `Delay Smoke ${tag}`,
      role: Role.STUDENT,
    },
    select: { id: true },
  });
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, enrollmentNo: tag },
    select: { id: true },
  });
  await prisma.parentChild.create({
    data: { parentId: guardianProfileIds[0]!, studentId: profile.id },
  });
  await prisma.enrollment.create({
    data: {
      studentId: profile.id,
      busId: bus.id,
      stopId: stop.id,
      direction,
      academicYear: "2026-27",
    },
  });

  const existingTrip = await prisma.trip.findFirst({
    where: { busId: bus.id, date: dayStart, direction },
    select: { id: true },
  });
  if (existingTrip) {
    await prisma.pickupRecord.deleteMany({ where: { tripId: existingTrip.id } });
    await prisma.trip.delete({ where: { id: existingTrip.id } });
  }

  const trip = await prisma.trip.create({
    data: {
      busId: bus.id,
      routeId: bus.routeId!,
      driverId: driver.id,
      date: dayStart,
      direction,
      status: TripStatus.ONGOING,
      scheduledStart: new Date(),
    },
    select: { id: true },
  });

  await prisma.pickupRecord.create({
    data: {
      tripId: trip.id,
      studentId: profile.id,
      stopId: stop.id,
      status: PickupStatus.PENDING,
    },
  });

  const delayWhere = {
    userId: { in: guardianIds },
    type: NotificationType.DELAY,
    createdAt: { gte: new Date(Date.now() - 60_000) },
  } as const;
  const nearbyWhere = {
    userId: { in: guardianIds },
    type: NotificationType.BUS_NEARBY,
    createdAt: { gte: new Date(Date.now() - 60_000) },
  } as const;

  const delayBefore = await prisma.notification.count({ where: delayWhere });
  const nearbyBefore = await prisma.notification.count({ where: nearbyWhere });

  // --- The bus arrives, late --------------------------------------------------
  await evaluateGeofence({
    busId: bus.id,
    position: { lat: stop.lat, lng: stop.lng },
    direction,
    tripId: trip.id,
  });

  const delayRing = await prisma.stopApproach.findFirst({
    where: { busId: bus.id, stopId: stop.id, direction, ring: "DELAY", date: dayStart },
  });
  report(!!delayRing, "claims a DELAY ring when the bus arrives late");

  const delayAfter = await prisma.notification.count({ where: delayWhere });
  report(
    delayAfter > delayBefore,
    "notifies the guardian that the bus is running late",
    `${delayBefore} -> ${delayAfter}`,
  );

  const delayNote = await prisma.notification.findFirst({
    where: delayWhere,
    orderBy: { createdAt: "desc" },
    select: { title: true, body: true },
  });
  report(
    !!delayNote && /min late/.test(delayNote.body),
    "the delay notification says how late the bus is",
    delayNote?.body ?? "no notification",
  );

  // The arrival message itself carries the delay, so a parent who only reads
  // that one still knows the bus is late.
  const nearbyAfter = await prisma.notification.count({ where: nearbyWhere });
  report(nearbyAfter > nearbyBefore, "still sends the arrival alert");

  const arrivalNote = await prisma.notification.findFirst({
    where: nearbyWhere,
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  report(
    !!arrivalNote && /min late/.test(arrivalNote.body),
    "the arrival message includes the delay",
    arrivalNote?.body ?? "no notification",
  );

  // --- Idempotency ------------------------------------------------------------
  const delayBeforeSecond = await prisma.notification.count({ where: delayWhere });
  await evaluateGeofence({
    busId: bus.id,
    position: { lat: stop.lat, lng: stop.lng },
    direction,
    tripId: trip.id,
  });
  const delayAfterSecond = await prisma.notification.count({ where: delayWhere });
  report(
    delayAfterSecond === delayBeforeSecond,
    "a second arrival sends no second delay notification",
  );

  // --- Cleanup -----------------------------------------------------------------
  await prisma.pickupRecord.deleteMany({ where: { tripId: trip.id } });
  await prisma.trip.delete({ where: { id: trip.id } });
  await prisma.enrollment.deleteMany({ where: { studentId: profile.id } });
  await prisma.parentChild.deleteMany({ where: { studentId: profile.id } });
  await prisma.studentProfile.delete({ where: { id: profile.id } });
  await prisma.user.delete({ where: { id: user.id } });
  if (routeStop) {
    await prisma.routeStop.update({
      where: { id: routeStop.id },
      data: { scheduledHHMM: originalSchedule },
    });
  }
  await prisma.stopApproach.deleteMany({ where: { busId: bus.id, date: dayStart } });
  await prisma.notification.deleteMany({ where: delayWhere });
  await prisma.notification.deleteMany({ where: nearbyWhere });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\n  smoke:delay threw:\n", error);
  await prisma.$disconnect();
  process.exit(1);
});
