/**
 * Geofence smoke test: the "your bus is almost at your stop" alert.
 *
 *   npm run smoke:geofence
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
 *
 * The decision — which ring a stop has entered — is pure and covered by
 * `src/lib/geofence.test.ts`. What that cannot check is the part that actually
 * fails in production: that the dedup row is written before the notification,
 * that a second tick does not send a second alert, and that the alert reaches
 * the guardians of the students enrolled at *that* stop rather than every parent
 * in the college. Those depend on a real database and real foreign keys.
 *
 * It runs the same `evaluateGeofence` the simulator and the driver's socket path
 * call, against the live cluster, and rolls back everything it wrote.
 *
 *   npm run db:start          # if the machine has rebooted
 *   npm run smoke:geofence
 */
import "dotenv/config";

// The app's own client, not a private second pool: `evaluateGeofence` reaches
// `notify()` through `src/lib/db`, so two pools in one process could together
// exhaust the cluster's connection limit and drop an alert no check observes.
// See `smoke-boarding.ts` for the full account. Same reasoning, same fix as
// `smoke-reconcile`.
import { prisma } from "../src/lib/db";
import { NotificationType } from "../src/generated/prisma/enums";
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

async function main() {
  console.log("\nGeofence smoke test\n");

  // Pick the bus by the property this test needs — a route of at least two
  // stops, and an active enrolment at one of those stops whose student has a
  // guardian — rather than picking a bus and hoping it has one.
  //
  // Both parts are load-bearing. The previous code took the first bus with a
  // route and then searched *that* bus for a guardian-backed enrolment.
  // `findFirst` has no ordering, and earlier suites in `smoke:all` create buses
  // and move enrolments around, so "first" was often a bus with nobody enrolled
  // on it: the suite failed with "No enrolled stop with a guardian on this bus",
  // but only when it ran after the others. Ordering by `busNumber` (and by
  // `stopOrder` within the route) makes the choice reproducible, and searching
  // *for* the enrolment instead of *within* an arbitrary bus makes it
  // independent of whatever the earlier suites left behind.
  const candidates = await prisma.bus.findMany({
    where: { routeId: { not: null } },
    orderBy: { busNumber: "asc" },
    select: {
      id: true,
      busNumber: true,
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

  type Stop = { id: string; name: string; lat: number; lng: number };

  let bus: (typeof candidates)[number] | null = null;
  let stops: Stop[] = [];

  // The first stop of the first eligible bus with a guardian-backed enrolment,
  // so there is somebody to notify. Every stop on the route would work for the
  // ring logic; this one makes the fan-out assertion meaningful.
  let chosen: {
    stop: Stop;
    direction: "PICKUP" | "DROPOFF";
    guardianIds: string[];
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
          student: { select: { guardians: { select: { parent: { select: { userId: true } } } } } },
        },
      });
      if (!enrollment) continue;

      const guardianIds = enrollment.student.guardians.map((g) => g.parent.userId);
      if (guardianIds.length === 0) continue;

      bus = candidate;
      stops = routeStops;
      chosen = { stop, direction: enrollment.direction, guardianIds };
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

  const { stop, direction, guardianIds } = chosen;
  const date = geofenceDateKey(new Date());
  const dayStart = new Date(`${date}T00:00:00`);

  console.log(
    `  bus ${bus.busNumber} · stop ${stop.name} · ${direction} · ${guardianIds.length} guardian(s)\n`,
  );

  // Clean slate for this bus/stop/day so a previous run cannot mask a failure.
  const beforeApproaches = await prisma.stopApproach.deleteMany({
    where: { busId: bus.id, stopId: stop.id, date: dayStart },
  });
  if (beforeApproaches.count > 0) {
    console.log(`  (cleared ${beforeApproaches.count} leftover row(s) from a previous run)`);
  }

  const notificationWhere = {
    userId: { in: guardianIds },
    type: NotificationType.BUS_NEARBY,
    createdAt: { gte: new Date(Date.now() - 60_000) },
  } as const;

  const notificationsBefore = await prisma.notification.count({ where: notificationWhere });

  // --- The alert itself: a position sitting on the stop ----------------------
  await evaluateGeofence({
    busId: bus.id,
    position: { lat: stop.lat, lng: stop.lng },
    direction,
    tripId: null,
    stops,
  });

  const arriving = await prisma.stopApproach.findFirst({
    where: { busId: bus.id, stopId: stop.id, direction, ring: "ARRIVING", date: dayStart },
  });
  report(!!arriving, "writes an ARRIVING dedup row when the bus reaches the stop");

  const notificationsAfter = await prisma.notification.count({ where: notificationWhere });
  report(
    notificationsAfter > notificationsBefore,
    "notifies at least one guardian of a student enrolled at that stop",
    `${notificationsBefore} -> ${notificationsAfter}`,
  );

  // The message must carry the stop it is about, or it is an alert with no verb.
  const latest = await prisma.notification.findFirst({
    where: notificationWhere,
    orderBy: { createdAt: "desc" },
    select: { title: true, body: true, data: true },
  });
  report(
    !!latest && latest.body.includes(stop.name),
    "the notification names the stop",
    latest?.body ?? "no notification",
  );
  report(
    !!latest && (latest.data as { href?: string } | null)?.href?.startsWith("/track/") === true,
    "the notification deep-links to the live map",
    JSON.stringify(latest?.data ?? null),
  );

  // --- Idempotency: a second tick must send nothing -------------------------
  const approachesAfterFirst = await prisma.stopApproach.count({
    where: { busId: bus.id, stopId: stop.id, date: dayStart },
  });
  const notificationsAfterFirst = await prisma.notification.count({ where: notificationWhere });

  await evaluateGeofence({
    busId: bus.id,
    position: { lat: stop.lat, lng: stop.lng },
    direction,
    tripId: null,
    stops,
  });

  const approachesAfterSecond = await prisma.stopApproach.count({
    where: { busId: bus.id, stopId: stop.id, date: dayStart },
  });
  const notificationsAfterSecond = await prisma.notification.count({ where: notificationWhere });

  report(
    approachesAfterSecond === approachesAfterFirst,
    "a repeat tick writes no second dedup row",
    `${approachesAfterFirst} -> ${approachesAfterSecond}`,
  );
  report(
    notificationsAfterSecond === notificationsAfterFirst,
    "a repeat tick sends no second notification",
    `${notificationsAfterFirst} -> ${notificationsAfterSecond}`,
  );

  // --- The outer ring fires independently, then is also deduped -------------
  // 500 m out is inside the approaching ring but outside the arriving one, so
  // this is a *different* key and must send. Doing it at a different stop keeps
  // it independent of the arriving row above.
  const outerStop = stops.find((s) => s.id !== stop.id) ?? stop;
  const outerStart = await prisma.stopApproach.deleteMany({
    where: { busId: bus.id, stopId: outerStop.id, date: dayStart },
  });
  void outerStart;

  // 500 m due north of the outer stop.
  await evaluateGeofence({
    busId: bus.id,
    position: { lat: outerStop.lat + 500 / 111_132, lng: outerStop.lng },
    direction,
    tripId: null,
    stops,
  });

  const approaching = await prisma.stopApproach.findFirst({
    where: { busId: bus.id, stopId: outerStop.id, direction, ring: "APPROACHING", date: dayStart },
  });
  report(!!approaching, "sends the outer APPROACHING alert around 500 m out");

  // --- Cleanup ---------------------------------------------------------------
  const cleanedApproaches = await prisma.stopApproach.deleteMany({
    where: { busId: bus.id, date: dayStart },
  });
  const cleanedNotifications = await prisma.notification.deleteMany({ where: notificationWhere });

  console.log(
    `\n  cleaned up ${cleanedApproaches.count} dedup row(s) and ${cleanedNotifications.count} notification(s)`,
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\n  smoke:geofence threw:\n", error);
  await prisma.$disconnect();
  process.exit(1);
});
