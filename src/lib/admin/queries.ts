import "server-only";
import { prisma } from "@/lib/db";

/**
 * List queries behind the admin screens.
 *
 * Kept separate from `lib/queries.ts` on purpose: those are narrow reads scoped
 * to one signed-in user, these are broad admin reads that join a lot and must
 * not accidentally end up on a student-facing page.
 *
 * Every function here is called only from a page guarded by `requireRole(ADMIN)`.
 */

export async function listStops() {
  const stops = await prisma.stop.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      lat: true,
      lng: true,
      isActive: true,
      createdAt: true,
      _count: { select: { routeStops: true } },
    },
  });
  return stops.map((s) => ({ ...s, routeCount: s._count.routeStops }));
}

export async function getStop(id: string) {
  const stop = await prisma.stop.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      lat: true,
      lng: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      routeStops: {
        orderBy: { stopOrder: "asc" },
        select: {
          stopOrder: true,
          scheduledHHMM: true,
          route: { select: { id: true, name: true, code: true } },
        },
      },
      enrollments: {
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          direction: true,
          academicYear: true,
          isActive: true,
          student: {
            select: {
              enrollmentNo: true,
              user: { select: { name: true } },
            },
          },
        },
      },
      /**
       * True totals, not the length of the 25-row preview above.
       *
       * `pickupRecords` is what makes a stop undeletable: every check-in ever
       * taken at this point points at it, and that history is the reason the
       * system exists.
       */
      _count: {
        select: { enrollments: true, routeStops: true, stopEvents: true, pickupRecords: true },
      },
    },
  });
  if (!stop) return null;

  const { _count: totals, ...rest } = stop;
  const referenced =
    totals.routeStops > 0 || totals.enrollments > 0 || totals.stopEvents > 0 || totals.pickupRecords > 0;

  return {
    ...rest,
    enrollmentCount: totals.enrollments,
    /** Whether a hard delete is still possible, and what is blocking it. */
    deletable: !referenced,
    blockers: [
      totals.routeStops > 0 ? `${totals.routeStops} route stop(s)` : null,
      totals.enrollments > 0 ? `${totals.enrollments} enrolment(s)` : null,
      totals.stopEvents > 0 ? `${totals.stopEvents} trip visit(s)` : null,
      totals.pickupRecords > 0 ? `${totals.pickupRecords} attendance record(s)` : null,
    ].filter((b): b is string => b !== null),
    routes: stop.routeStops.map((rs) => ({
      id: rs.route.id,
      name: rs.route.name,
      code: rs.route.code,
      stopOrder: rs.stopOrder,
      scheduledHHMM: rs.scheduledHHMM,
    })),
  };
}

export async function listRoutes() {
  return prisma.route.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      isActive: true,
      _count: { select: { routeStops: true, buses: true, trips: true } },
    },
  });
}

export async function getRoute(id: string) {
  return prisma.route.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      isActive: true,
      routeStops: {
        orderBy: { stopOrder: "asc" },
        select: {
          id: true,
          stopOrder: true,
          offsetMeters: true,
          scheduledHHMM: true,
          stop: {
            select: {
              id: true,
              name: true,
              address: true,
              lat: true,
              lng: true,
              isActive: true,
              _count: { select: { enrollments: true } },
            },
          },
        },
      },
      buses: {
        select: { id: true, busNumber: true, registrationNo: true, status: true },
      },
      // Mirrors the guard inside `deleteRoute` exactly, so the button is
      // hidden in precisely the cases where the action would refuse.
      _count: { select: { buses: true, trips: true } },
    },
  });
}

/** Stops not already on this route, for the "add stop" picker. */
export async function listStopsNotOnRoute(routeId: string) {
  const taken = await prisma.routeStop.findMany({
    where: { routeId },
    select: { stopId: true },
  });
  const ids = new Set(taken.map((t) => t.stopId));
  const stops = await prisma.stop.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true },
  });
  return stops.filter((s) => !ids.has(s.id));
}

export async function listBuses() {
  return prisma.bus.findMany({
    orderBy: { busNumber: "asc" },
    select: {
      id: true,
      busNumber: true,
      registrationNo: true,
      capacity: true,
      model: true,
      status: true,
      routeId: true,
      onboardCount: true,
      lastLocationAt: true,
      route: { select: { id: true, name: true, code: true } },
      busAssignments: {
        where: { validTo: null },
        select: {
          isPrimary: true,
          driver: { select: { id: true, name: true, phone: true } },
        },
      },
      _count: { select: { enrollments: true, trips: true } },
    },
  });
}

export async function getBus(id: string) {
  return prisma.bus.findUnique({
    where: { id },
    select: {
      id: true,
      busNumber: true,
      registrationNo: true,
      capacity: true,
      model: true,
      status: true,
      routeId: true,
      onboardCount: true,
      createdAt: true,
      /**
       * Active enrolments only.
       *
       * A filtered relation count, which is both what the "Enrolled" figure
       * should show — an ended assignment is history, not a seat held — and
       * exactly the predicate `deleteBus` uses to decide whether removal is
       * allowed.
       */
      _count: { select: { enrollments: { where: { isActive: true } }, trips: true } },
      busAssignments: {
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          isPrimary: true,
          validFrom: true,
          validTo: true,
          driver: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              driverProfile: { select: { licenseNo: true, licenseExpiry: true } },
            },
          },
        },
      },
    },
  });
}

export async function listDrivers() {
  const drivers = await prisma.user.findMany({
    where: { role: "DRIVER" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      driverProfile: {
        select: {
          id: true,
          licenseNo: true,
          licenseExpiry: true,
          experienceYr: true,
        },
      },
      busAssignments: {
        where: { validTo: null },
        select: {
          isPrimary: true,
          bus: { select: { id: true, busNumber: true, registrationNo: true } },
        },
      },
      _count: { select: { drivenTrips: true } },
    },
  });

  const today = new Date();
  return drivers.map((d) => {
    const expiry = d.driverProfile?.licenseExpiry ?? null;
    return {
      ...d,
      profile: d.driverProfile,
      licenseExpired: expiry != null && expiry.getTime() < today.getTime(),
      /**
       * Days left on the licence, or null when there is no expiry recorded.
       * Computed here rather than in the page: `Date.now()` inside render is
       * not pure, and the page only needs this number to pick a badge colour.
       */
      licenseDaysLeft: expiry
        ? Math.round((expiry.getTime() - today.getTime()) / 86_400_000)
        : null,
      buses: d.busAssignments,
    };
  });
}

export async function getDriver(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      driverProfile: {
        select: {
          id: true,
          licenseNo: true,
          licenseExpiry: true,
          experienceYr: true,
        },
      },
      busAssignments: {
        orderBy: { validFrom: "desc" },
        select: {
          id: true,
          isPrimary: true,
          validFrom: true,
          validTo: true,
          bus: { select: { id: true, busNumber: true, registrationNo: true } },
        },
      },
      _count: { select: { drivenTrips: true } },
    },
  });
}

/**
 * Every student with their current assignment, for the enrolment screen.
 * Left-joined so unenrolled students still appear — they are exactly the rows
 * an admin needs to fix.
 */
export async function listStudents() {
  const [students, endedRows] = await Promise.all([
    prisma.studentProfile.findMany({
      orderBy: { enrollmentNo: "asc" },
      select: {
        id: true,
        enrollmentNo: true,
        department: true,
        yearOfStudy: true,
        user: {
          select: { id: true, name: true, email: true, phone: true, isActive: true },
        },
        enrollments: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            direction: true,
            academicYear: true,
            stop: { select: { id: true, name: true } },
            bus: {
              select: {
                id: true,
                busNumber: true,
                registrationNo: true,
                route: { select: { id: true, name: true } },
              },
            },
          },
        },
        guardians: {
          select: {
            parent: {
              select: {
                id: true,
                relation: true,
                user: { select: { name: true, email: true, phone: true } },
              },
            },
          },
        },
      },
    }),
    /**
     * Ended assignments, fetched separately and merged in below.
     *
     * Prisma cannot select the same relation twice under two keys, and an ended
     * row still holds its unique key — so the admin has to be able to see that
     * "that assignment already exists" is not a bug, and restore it in one
     * click. Capped per student because this is context, not the main list.
     */
    prisma.enrollment.findMany({
      where: { isActive: false },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        studentId: true,
        direction: true,
        academicYear: true,
        updatedAt: true,
        stop: { select: { name: true } },
        bus: { select: { id: true, busNumber: true } },
      },
    }),
  ]);

  const endedByStudent = new Map<string, typeof endedRows>();
  for (const row of endedRows) {
    const bucket = endedByStudent.get(row.studentId);
    if (!bucket) endedByStudent.set(row.studentId, [row]);
    else if (bucket.length < 3) bucket.push(row);
  }

  return students.map((s) => ({
    ...s,
    guardianCount: s.guardians.length,
    guardians: s.guardians.map((g) => g.parent),
    endedEnrollments: endedByStudent.get(s.id) ?? [],
  }));
}

export type StudentRow = Awaited<ReturnType<typeof listStudents>>[number];

export async function listEnrollments() {
  return prisma.enrollment.findMany({
    where: { isActive: true },
    orderBy: [{ academicYear: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      direction: true,
      academicYear: true,
      student: {
        select: {
          id: true,
          enrollmentNo: true,
          user: { select: { name: true } },
        },
      },
      bus: {
        select: {
          id: true,
          busNumber: true,
          registrationNo: true,
          capacity: true,
          route: { select: { name: true } },
        },
      },
      stop: { select: { id: true, name: true } },
    },
  });
}

/** Bus capacity vs enrolled count, so the admin sees an overbooking warning. */
export async function getBusLoads() {
  const buses = await prisma.bus.findMany({
    where: { status: { not: "INACTIVE" } },
    orderBy: { busNumber: "asc" },
    select: {
      id: true,
      busNumber: true,
      registrationNo: true,
      capacity: true,
      status: true,
      onboardCount: true,
      route: { select: { id: true, name: true } },
      enrollments: {
        where: { isActive: true },
        select: { id: true, stop: { select: { name: true } } },
      },
    },
  });

  return buses.map((b) => {
    const byStop = new Map<string, number>();
    for (const e of b.enrollments) {
      const key = e.stop.name;
      byStop.set(key, (byStop.get(key) ?? 0) + 1);
    }
    return {
      id: b.id,
      busNumber: b.busNumber,
      registrationNo: b.registrationNo,
      capacity: b.capacity,
      status: b.status,
      onboardCount: b.onboardCount,
      route: b.route,
      enrolled: b.enrollments.length,
      remaining: b.capacity - b.enrollments.length,
      overbooked: b.enrollments.length > b.capacity,
      byStop: [...byStop.entries()].map(([stop, count]) => ({ stop, count })),
    };
  });
}

export async function listTrips(filter?: { date?: string; status?: string }) {
  const dateFilter = filter?.date
    ? (() => {
        // Parse as a local calendar date, not UTC midnight, or a trip recorded
        // in the evening lands on the previous day.
        const [y, m, d] = filter.date!.split("-").map(Number);
        const start = new Date(y, m - 1, d);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { gte: start, lt: end };
      })()
    : undefined;

  return prisma.trip.findMany({
    where: {
      date: dateFilter,
      status: filter?.status
        ? (filter.status as "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED")
        : undefined,
    },
    orderBy: [{ date: "desc" }, { scheduledStart: "asc" }],
    take: 100,
    select: {
      id: true,
      date: true,
      direction: true,
      status: true,
      scheduledStart: true,
      startedAt: true,
      endedAt: true,
      delaySeconds: true,
      bus: {
        select: {
          id: true,
          busNumber: true,
          registrationNo: true,
          route: { select: { id: true, name: true } },
        },
      },
      driver: { select: { id: true, name: true } },
      _count: { select: { pickupRecords: true, stopEvents: true } },
      pickupRecords: {
        select: { status: true },
      },
    },
  });
}

/**
 * A trip with everything the attendance screen needs: the stop sequence from
 * the route, and the students expected at each stop for this direction.
 */
type RosterBucket = {
  stop: { id: string; name: string; lat: number; lng: number };
  stopOrder: number | null;
  scheduledHHMM: string | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
  students: {
    id: string;
    stopId: string;
    status: string;
    waitingMarkedAt: Date | null;
    pickedAt: Date | null;
    student: {
      enrollmentNo: string;
      user: { name: string; phone: string | null };
    };
  }[];
};

export async function getTripDetail(id: string) {
  const trip = await prisma.trip.findUnique({
    where: { id },
    select: {
      id: true,
      date: true,
      direction: true,
      status: true,
      scheduledStart: true,
      startedAt: true,
      endedAt: true,
      delaySeconds: true,
      bus: {
        select: {
          id: true,
          busNumber: true,
          registrationNo: true,
          capacity: true,
          route: {
            select: {
              id: true,
              name: true,
              routeStops: {
                orderBy: { stopOrder: "asc" },
                select: {
                  id: true,
                  stopOrder: true,
                  scheduledHHMM: true,
                  stop: { select: { id: true, name: true, lat: true, lng: true } },
                },
              },
            },
          },
        },
      },
      driver: { select: { id: true, name: true, phone: true } },
      busId: true,
      driverId: true,
      stopEvents: {
        select: {
          id: true,
          stopId: true,
          arrivedAt: true,
          departedAt: true,
          delaySeconds: true,
        },
      },
      pickupRecords: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          stopId: true,
          status: true,
          waitingMarkedAt: true,
          pickedAt: true,
          student: {
            select: {
              enrollmentNo: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      },
      alerts: {
        select: { id: true, type: true, message: true, status: true, createdAt: true },
      },
    },
  });

  if (!trip) return null;

  const roster = new Map<string, RosterBucket>();

  // Build from the route so stops with nobody on them still show up: an empty
  // stop is exactly what tells an admin the bus has not reached it yet.
  for (const rs of trip.bus.route?.routeStops ?? []) {
    const event = trip.stopEvents.find((e) => e.stopId === rs.stop.id);
    roster.set(rs.stop.id, {
      stop: rs.stop,
      stopOrder: rs.stopOrder,
      scheduledHHMM: rs.scheduledHHMM,
      arrivedAt: event?.arrivedAt ?? null,
      departedAt: event?.departedAt ?? null,
      students: [],
    });
  }

  for (const record of trip.pickupRecords) {
    // A record for a stop that has since been removed from the route still has
    // to appear, or the attendance would silently lose a student.
    const bucket: RosterBucket = roster.get(record.stopId) ?? {
      stop: { id: record.stopId, name: "Stop no longer on this route", lat: 0, lng: 0 },
      stopOrder: null,
      scheduledHHMM: null,
      arrivedAt: null,
      departedAt: null,
      students: [],
    };
    bucket.students.push(record);
    roster.set(record.stopId, bucket);
  }

  const stops = [...roster.values()].sort((a, b) => {
    if (a.stopOrder != null && b.stopOrder != null) return a.stopOrder - b.stopOrder;
    if (a.stopOrder != null) return -1;
    if (b.stopOrder != null) return 1;
    return a.stop.name.localeCompare(b.stop.name);
  });

  const counts = { picked: 0, waiting: 0, missed: 0, absent: 0, pending: 0 };
  for (const record of trip.pickupRecords) {
    if (record.status === "PICKED") counts.picked++;
    else if (record.status === "WAITING") counts.waiting++;
    else if (record.status === "MISSED") counts.missed++;
    else if (record.status === "ABSENT") counts.absent++;
    else counts.pending++;
  }

  // How many rows starting this trip would create. Shown on a scheduled trip so
  // the admin can see the size of the roster before committing to it — a bus
  // with 40 enrolled students and nobody on a route stop is worth catching now.
  const expectedCount = await prisma.enrollment.count({
    where: { busId: trip.busId, direction: trip.direction, isActive: true },
  });

  return { trip, stops, counts, expectedCount };
}

export async function listAlerts() {
  const alerts = await prisma.emergencyAlert.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      busId: true,
      type: true,
      message: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      acknowledgedAt: true,
      resolutionNote: true,
      lat: true,
      lng: true,
      trip: { select: { id: true, date: true, direction: true, status: true } },
      raisedBy: { select: { name: true, role: true } },
      resolvedBy: { select: { name: true } },
    },
  });

  // EmergencyAlert stores a busId but declares no relation to Bus, so the bus
  // summary is joined in a second query rather than duplicating bus data here.
  const busIds = [...new Set(alerts.map((a) => a.busId))];
  const buses = await prisma.bus.findMany({
    where: { id: { in: busIds } },
    select: {
      id: true,
      busNumber: true,
      registrationNo: true,
      route: { select: { name: true } },
    },
  });
  const byId = new Map(buses.map((b) => [b.id, b]));

  return alerts.map((a) => ({ ...a, bus: byId.get(a.busId) ?? null }));
}
