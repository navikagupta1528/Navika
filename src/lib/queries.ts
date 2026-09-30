import "server-only";
import { prisma } from "@/lib/db";
import { Role, TripDirection, TripStatus } from "@/generated/prisma/enums";

/**
 * Read helpers shared by the dashboards. Every function that takes a userId
 * scopes its query to that user, so a page cannot accidentally return another
 * student's data.
 */

/** The student's active enrolment for the current academic year, if any. */
export async function getStudentAssignment(studentProfileId: string) {
  return prisma.enrollment.findFirst({
    where: { studentId: studentProfileId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      direction: true,
      academicYear: true,
      bus: {
        select: {
          id: true,
          busNumber: true,
          registrationNo: true,
          capacity: true,
          status: true,
          currentLat: true,
          currentLng: true,
          headingDeg: true,
          speedKph: true,
          lastLocationAt: true,
          onboardCount: true,
          routeId: true,
          route: {
            select: {
              id: true,
              name: true,
              code: true,
              routeStops: {
                orderBy: { stopOrder: "asc" },
                select: {
                  id: true,
                  stopOrder: true,
                  scheduledHHMM: true,
                  stop: { select: { id: true, name: true, address: true, lat: true, lng: true } },
                },
              },
            },
          },
        },
      },
      stop: { select: { id: true, name: true, address: true, lat: true, lng: true } },
    },
  });
}

/** The child's assignment, seen through a parent's account. */
export async function getChildAssignment(studentProfileId: string) {
  return getStudentAssignment(studentProfileId);
}

/** Today's trip for a bus, in a given direction, if it exists. */
export async function getTodayTrip(busId: string, direction: "PICKUP" | "DROPOFF") {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return prisma.trip.findFirst({
    where: {
      busId,
      date: { gte: start, lt: end },
      direction: direction === "PICKUP" ? TripDirection.PICKUP : TripDirection.DROPOFF,
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      delaySeconds: true,
      direction: true,
      stopEvents: {
        select: {
          id: true,
          arrivedAt: true,
          departedAt: true,
          delaySeconds: true,
          stopId: true,
        },
      },
    },
  });
}

/** Waiting and picked counts per stop for a trip, for the driver checklist. */
export async function getTripPickupSummary(tripId: string) {
  const records = await prisma.pickupRecord.findMany({
    where: { tripId },
    select: {
      id: true,
      stopId: true,
      status: true,
      waitingMarkedAt: true,
      pickedAt: true,
      student: {
        select: {
          id: true,
          enrollmentNo: true,
          user: { select: { name: true, phone: true } },
        },
      },
    },
  });

  const byStop = new Map<
    string,
    {
      stopId: string;
      waiting: typeof records;
      picked: typeof records;
      pending: typeof records;
    }
  >();

  for (const record of records) {
    const bucket =
      byStop.get(record.stopId) ??
      { stopId: record.stopId, waiting: [], picked: [], pending: [] };

    if (record.status === "PICKED") bucket.picked.push(record);
    else if (record.status === "MISSED") bucket.waiting.push(record);
    else if (record.status === "WAITING") bucket.waiting.push(record);
    else bucket.pending.push(record);

    byStop.set(record.stopId, bucket);
  }

  return { records, byStop };
}

/** Count of alerts still waiting on an admin, used for the sidebar badge. */
export async function getAdminAlerts() {
  return prisma.emergencyAlert.count({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });
}

/** Fleet overview for the admin dashboard. */
export async function getAdminOverview() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalBuses,
    activeBuses,
    totalStudents,
    totalDrivers,
    totalStops,
    totalRoutes,
    tripsToday,
    tripsOngoing,
    openAlerts,
  ] = await Promise.all([
    prisma.bus.count(),
    prisma.bus.count({ where: { status: "ACTIVE" } }),
    prisma.studentProfile.count(),
    prisma.user.count({ where: { role: Role.DRIVER } }),
    prisma.stop.count(),
    prisma.route.count(),
    prisma.trip.count({ where: { date: { gte: today } } }),
    prisma.trip.count({ where: { status: TripStatus.ONGOING } }),
    prisma.emergencyAlert.count({ where: { status: "OPEN" } }),
  ]);

  const liveBuses = await prisma.bus.findMany({
    where: { lastLocationAt: { not: null } },
    orderBy: { lastLocationAt: "desc" },
    take: 25,
    select: {
      id: true,
      busNumber: true,
      currentLat: true,
      currentLng: true,
      speedKph: true,
      lastLocationAt: true,
      onboardCount: true,
      isSimulated: true,
      route: { select: { name: true, code: true } },
    },
  });

  return {
    totalBuses,
    activeBuses,
    totalStudents,
    totalDrivers,
    totalStops,
    totalRoutes,
    tripsToday,
    tripsOngoing,
    openAlerts,
    liveBuses,
  };
}
