/**
 * Boarding smoke test: "the bus left without your child."
 *
 *   npm run smoke:boarding
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
 *
 * The decision — which stop has been left, and what that means for a waiting
 * student — is pure and covered by `src/lib/boarding.test.ts`. What that cannot
 * check is the part that actually fails in production: that the DEPARTED ring
 * is claimed before the roster is written, that a waiting student becomes
 * MISSED while a merely-unmarked one becomes ABSENT, that a child already on
 * the bus is never demoted, and that the alarm reaches the guardians of the
 * student who was left rather than every parent in the college.
 *
 * It runs the same `evaluateDepartures` the driver's socket path calls, against
 * the live cluster, and rolls back everything it wrote.
 *
 *   npm run db:start          # if the machine has rebooted
 *   npm run smoke:boarding
 */
import "dotenv/config";

/*
 * The app's own client, not a private one.
 *
 * `evaluateDepartures` and `evaluateGeofence` reach `notify()` through
 * `src/lib/db`, so constructing a second `PrismaClient` here gave this process
 * TWO independent pools against one cluster. Pools open connections lazily up
 * to `pg`'s default of ten each, and under the full `smoke:all` run the pair
 * pushed past the cluster's ceiling: `notify()` caught "too many clients
 * already" and dropped the alert on the floor. Nothing failed — the error is
 * swallowed by design — so the suite went green over a notification that was
 * never written, which is the exact shape of a false pass.
 *
 * One process, one pool, same rows the server writes. `smoke-reconcile` does
 * the same; the other suites are being brought into line with it.
 */
import { prisma } from "../src/lib/db";
import { NotificationType, PickupStatus, Role, TripStatus } from "../src/generated/prisma/enums";
import { evaluateGeofence } from "../src/server/geofence-watcher";
import { evaluateDepartures } from "../src/server/boarding-watcher";
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

/** A point `meters` due north of the stop — single-axis arithmetic, as in the unit tests. */
function northOf(stop: Stop, meters: number): { lat: number; lng: number } {
  return { lat: stop.lat + meters / 111_132, lng: stop.lng };
}

async function main() {
  console.log("\nBoarding smoke test\n");

  // Pick the bus by the property this test needs — a route of at least two
  // stops and an active enrolment at one of them whose student has a guardian —
  // rather than picking a bus and hoping. Same reasoning as `smoke-geofence`.
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
            select: { stop: { select: { id: true, name: true, lat: true, lng: true } } },
          },
        },
      },
    },
  });

  let bus: (typeof candidates)[number] | null = null;
  let stops: Stop[] = [];
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
      stops = routeStops;
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

  // --- Fixtures: a driver, three students at the stop, a trip, a roster -------
  // Everything created here is tagged with a recognizable prefix and removed at
  // the end, so a re-run starts from the same state.
  const tag = `smoke-boarding-${Date.now()}`;

  const driver = await prisma.user.findFirst({
    where: { role: Role.DRIVER, isActive: true },
    select: { id: true },
  });
  if (!driver) {
    console.error("  No active driver to run the trip. Run `npm run db:seed` first.");
    process.exit(2);
  }

  // Three students at the same stop, so the three outcomes can be asserted side
  // by side: one waiting, one never marked, one already on the bus.
  const statuses = [PickupStatus.WAITING, PickupStatus.PENDING, PickupStatus.PICKED] as const;
  const students: { id: string; userId: string }[] = [];

  for (let i = 0; i < statuses.length; i++) {
    const email = `${tag}-${i}@test.local`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: "x",
        name: `Boarding Smoke ${tag} ${i}`,
        role: Role.STUDENT,
      },
      select: { id: true },
    });
    const profile = await prisma.studentProfile.create({
      data: { userId: user.id, enrollmentNo: `${tag}-${i}` },
      select: { id: true },
    });
    // Link to the first guardian's *profile*, so the alarm has somewhere to go.
    // `ParentChild.parentId` is a profile id, not the user id the notification
    // fan-out addresses — the two are easy to confuse and the schema rejects it.
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
    students.push({ id: profile.id, userId: user.id });
  }

  /*
   * The trip is planted for tomorrow, not today, and that is the whole point.
   *
   * Planting it for today meant deleting whatever trip the bus already had
   * there — and on a seeded database that is a real trip belonging to a real
   * driver. The first version of this suite did exactly that, and the damage
   * outlived the suite by a long way: `smoke:auth` checks that driver1's
   * dashboard shows their route, the driver dashboard only shows a route when
   * the driver has a trip, and this suite had deleted it. The failure surfaced
   * several suites later as a missing route name on a dashboard that had
   * nothing to do with the cause, and it took a database query to find it.
   *
   * Tomorrow is free on every seeded database — the seed plants two live trips
   * for today and nothing else — so planting there is additive: the suite
   * creates a trip, proves the departure, removes it, and the database is
   * exactly as it was found. The trip's date is irrelevant to the assertion;
   * the departure logic keys off the trip id and the calendar day the bus
   * "arrived", never off the trip's own date.
   */
  const tripDate = new Date(dayStart);
  tripDate.setDate(tripDate.getDate() + 1);

  const trip = await prisma.trip.create({
    data: {
      busId: bus.id,
      routeId: bus.routeId!,
      driverId: driver.id,
      date: tripDate,
      direction,
      status: TripStatus.SCHEDULED,
      scheduledStart: new Date(),
    },
    select: { id: true },
  });

  const now = new Date();
  await prisma.pickupRecord.createMany({
    data: students.map((student, i) => ({
      tripId: trip.id,
      studentId: student.id,
      stopId: stop.id,
      status: statuses[i]!,
      waitingMarkedAt: statuses[i] === PickupStatus.WAITING ? now : null,
      pickedAt: statuses[i] === PickupStatus.PICKED ? now : null,
    })),
  });

  const notificationWhere = {
    userId: { in: guardianIds },
    type: NotificationType.NO_SHOW,
    createdAt: { gte: new Date(Date.now() - 60_000) },
  } as const;
  const notificationsBefore = await prisma.notification.count({ where: notificationWhere });

  // --- The bus arrives, then leaves -------------------------------------------
  await evaluateGeofence({
    busId: bus.id,
    position: { lat: stop.lat, lng: stop.lng },
    direction,
    tripId: trip.id,
    stops,
  });

  const arrived = await prisma.stopApproach.findFirst({
    where: { busId: bus.id, stopId: stop.id, direction, ring: "ARRIVING", date: dayStart },
  });
  report(!!arrived, "claims the ARRIVING ring before the bus can be reported as left");

  // 500 m out: outside the arrival ring, well past the departure threshold.
  await evaluateDepartures({
    busId: bus.id,
    position: northOf(stop, 500),
    direction,
    tripId: trip.id,
    stops,
  });

  const departed = await prisma.stopApproach.findFirst({
    where: { busId: bus.id, stopId: stop.id, direction, ring: "DEPARTED", date: dayStart },
  });
  report(!!departed, "claims a DEPARTED ring once the bus is clearly past the stop");

  // --- The roster is settled ---------------------------------------------------
  const records = await prisma.pickupRecord.findMany({
    where: { tripId: trip.id, stopId: stop.id },
    select: { status: true },
  });
  const byStatus = (status: PickupStatus) => records.filter((r) => r.status === status).length;

  report(byStatus(PickupStatus.MISSED) === 1, "marks the waiting student MISSED");
  report(byStatus(PickupStatus.ABSENT) === 1, "marks the unmarked student ABSENT, not MISSED");
  report(byStatus(PickupStatus.PICKED) === 1, "leaves the student already on the bus PICKED");

  // --- The alarm reaches the guardian ------------------------------------------
  const notificationsAfter = await prisma.notification.count({ where: notificationWhere });
  report(
    notificationsAfter > notificationsBefore,
    "notifies the guardian of the student who was left",
    `${notificationsBefore} -> ${notificationsAfter}`,
  );

  const latest = await prisma.notification.findFirst({
    where: notificationWhere,
    orderBy: { createdAt: "desc" },
    select: { title: true, body: true },
  });
  report(
    !!latest && latest.body.includes(stop.name),
    "the notification names the stop",
    latest?.body ?? "no notification",
  );

  // --- Idempotency: a second departure tick changes nothing --------------------
  const recordsBefore = await prisma.pickupRecord.count({ where: { tripId: trip.id } });
  const approachesBefore = await prisma.stopApproach.count({
    where: { busId: bus.id, date: dayStart },
  });
  const notificationsBeforeSecond = await prisma.notification.count({ where: notificationWhere });

  await evaluateDepartures({
    busId: bus.id,
    position: northOf(stop, 700),
    direction,
    tripId: trip.id,
    stops,
  });

  const recordsAfter = await prisma.pickupRecord.count({ where: { tripId: trip.id } });
  const approachesAfter = await prisma.stopApproach.count({
    where: { busId: bus.id, date: dayStart },
  });
  const notificationsAfterSecond = await prisma.notification.count({ where: notificationWhere });

  report(recordsAfter === recordsBefore, "a second tick changes no roster row");
  report(approachesAfter === approachesBefore, "a second tick writes no second dedup row");
  report(
    notificationsAfterSecond === notificationsBeforeSecond,
    "a second tick sends no second notification",
  );

  // --- Cleanup -----------------------------------------------------------------
  await prisma.pickupRecord.deleteMany({ where: { tripId: trip.id } });
  await prisma.trip.delete({ where: { id: trip.id } });
  await prisma.enrollment.deleteMany({ where: { student: { userId: { in: students.map((s) => s.userId) } } } });
  await prisma.parentChild.deleteMany({ where: { student: { userId: { in: students.map((s) => s.userId) } } } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: students.map((s) => s.userId) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${tag}@` } } });
  await prisma.stopApproach.deleteMany({ where: { busId: bus.id, date: dayStart } });
  await prisma.notification.deleteMany({ where: notificationWhere });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\n  smoke:boarding threw:\n", error);
  await prisma.$disconnect();
  process.exit(1);
});
