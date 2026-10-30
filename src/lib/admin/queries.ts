import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { AlertStatus, TripStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { paged } from "@/lib/paged-query";
import type { RawPage } from "@/lib/pagination";

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
       * The flag the simulator sets, so this screen can say whether the bus is
       * actually being driven rather than inferring it from a position that might
       * simply be recent.
       */
      isSimulated: true,
      /**
       * Route and its stop count.
       *
       * The count is what decides whether the bus can be simulated at all: the
       * movement maths needs a line to move along, and a route with one stop has
       * none. Reading it here means the button can be disabled with a reason
       * instead of failing after the click.
       */
      route: {
        select: {
          id: true,
          name: true,
          code: true,
          _count: { select: { routeStops: true } },
        },
      },
      /**
       * Active enrolments only.
       *
       * A filtered relation count, which is both what the "Enrolled" figure
       * should show â€” an ended assignment is history, not a seat held â€” and
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

/**
 * The trackers fitted to one bus, newest first.
 *
 * Returns the token *hash* and never the token itself: the plaintext is shown
 * once at creation and is not recoverable afterwards, which is the point.
 */
export async function listBusDevices(busId: string) {
  return prisma.busDevice.findMany({
    where: { busId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      label: true,
      lastSeenAt: true,
      revokedAt: true,
      createdAt: true,
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
 * The student list, searched and paged in the database.
 *
 * This used to fetch every student with every enrolment and every guardian
 * attached, then filter the lot in JavaScript. At forty students that is free; at
 * two thousand it is a page that loads the whole school to show twenty-five rows,
 * and the search has to wait for all of it before anything appears.
 *
 * Three things moved into SQL, and one of them is a behaviour change worth naming:
 *
 * - **Search.** A term is matched against name, email, enrollment number and
 *   department. It used to be matched against those four joined with spaces, which
 *   also matched a term *spanning* fields - `"aarav sharma@busguard"` would hit a
 *   student whose name and email happened to concatenate that way. Nobody types
 *   that on purpose, and it made results depend on field order.
 * - **Counting.** The tiles used to be computed from the fetched array, so they
 *   could only ever describe what had been loaded. They are real counts now, over
 *   the same filter as the rows, so they agree with the pager.
 * - **The ended-assignments lookup.** This fetched every ended enrolment in the
 *   database to show at most three per student on the page. It is now scoped to
 *   the students actually on this page.
 */
export async function listStudents(filter?: { q?: string; page?: RawPage }) {
  const term = filter?.q?.trim() ?? "";
  const where: Prisma.StudentProfileWhereInput = term
    ? {
        OR: [
          { enrollmentNo: { contains: term, mode: "insensitive" } },
          { department: { contains: term, mode: "insensitive" } },
          { user: { name: { contains: term, mode: "insensitive" } } },
          { user: { email: { contains: term, mode: "insensitive" } } },
        ],
      }
    : {};

  /** Students matching the filter who have no active assignment. */
  const unassignedWhere: Prisma.StudentProfileWhereInput = {
    AND: [where, { enrollments: { none: { isActive: true } } }],
  };
  /** Students matching the filter who have no guardian linked at all. */
  const noParentWhere: Prisma.StudentProfileWhereInput = {
    AND: [where, { guardians: { none: {} } }],
  };

  const [pagedStudents, unassigned, noParentTotal, noParentNames, needsAssignment, endedRows] =
    await Promise.all([
      paged({
        raw: filter?.page,
        perPage: 25,
        count: () => prisma.studentProfile.count({ where }),
        rows: ({ skip, take }) =>
          prisma.studentProfile.findMany({
            where,
            // `enrollmentNo` is unique in practice but not in the schema, so `id`
            // breaks the tie - see `withIdOrder` for why that is not optional.
            orderBy: [{ enrollmentNo: "asc" }, { id: "asc" }],
            skip,
            take,
            select: STUDENT_ROW_SELECT,
          }),
      }),

      prisma.studentProfile.count({ where: unassignedWhere }),
      prisma.studentProfile.count({ where: noParentWhere }),

      /*
       * Names for the warning banner, capped at eight.
       *
       * A separate query rather than a slice of the page's rows, because the
       * banner is about the whole filtered set while the page holds twenty-five of
       * them - slicing the page would name students who are not on screen and hide
       * ones that are.
       */
      prisma.studentProfile.findMany({
        where: noParentWhere,
        orderBy: [{ enrollmentNo: "asc" }, { id: "asc" }],
        take: 8,
        select: { id: true, user: { select: { name: true } } },
      }),

      /*
       * Students needing an assignment, for the shortcut card below the list.
       *
       * The one place that legitimately wants a capped list rather than a page: it
       * is a shortcut panel, not a result set. Capped at forty with the true
       * `unassigned` count beside it, so "and 12 more" stays honest - which is what
       * the card already did, from an array that happened to hold everyone.
       */
      prisma.studentProfile.findMany({
        where: unassignedWhere,
        orderBy: [{ enrollmentNo: "asc" }, { id: "asc" }],
        take: 40,
        select: { id: true, enrollmentNo: true, user: { select: { name: true } } },
      }),

      /**
       * Ended assignments, fetched separately and merged in below.
       *
       * Prisma cannot select the same relation twice under two keys, and an ended
       * row still holds its unique key â€” so the admin has to be able to see that
       * "that assignment already exists" is not a bug, and restore it in one
       * click. Capped per student because this is context, not the main list.
       *
       * Scoped to the students on this page: the query used to take every ended
       * row in the database and then discard all but three per student.
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

  return {
    students: pagedStudents.rows.map((s) => ({
      ...s,
      guardianCount: s.guardians.length,
      guardians: s.guardians.map((g) => g.parent),
      endedEnrollments: endedByStudent.get(s.id) ?? [],
    })),
    /** The pager's window, already clamped. */
    page: pagedStudents.page,
    /** True counts over the same filter as the rows, for the tiles. */
    counts: {
      /** Total matching the filter. Identical to the pager's total, on purpose. */
      total: pagedStudents.page.total,
      assigned: pagedStudents.page.total - unassigned,
      unassigned,
      noParent: noParentTotal,
      /**
       * Active enrolments belonging to students matching the filter.
       *
       * Counted rather than summed over the page's rows, which is what this used
       * to do - a tile reading "Assignments 25" on a paged list of forty-two
       * students is not a count, it is the page size.
       */
      assignments: await prisma.enrollment.count({
        where: { isActive: true, student: where },
      }),
    },
    /** Up to eight names for the unlinked-guardian warning. */
    noParentNames: noParentNames.map((s) => s.user.name),
    /** Up to forty students with no active assignment, for the shortcut card. */
    needsAssignment,
  };
}

/**
 * One student for the edit form, looked up by id.
 *
 * This existed as a `find` over the list, which is only correct while the list
 * holds every student. The moment it is paged, `?edit=<id>` for someone on page 4
 * silently renders the "new assignment" form instead - the link works, the page
 * loads, and the wrong form is on it.
 */
export async function getStudentForEdit(id: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id },
    select: STUDENT_ROW_SELECT,
  });
  if (!student) return null;

  const endedRows = await prisma.enrollment.findMany({
    where: { isActive: false, studentId: id },
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
  });

  return {
    ...student,
    guardianCount: student.guardians.length,
    guardians: student.guardians.map((g) => g.parent),
    endedEnrollments: endedRows.slice(0, 3),
  };
}

/**
 * The columns the list and the edit form both need.
 *
 * One definition, because the two were reading the same relations and drifting:
 * the form needs an assignment's bus and stop to prefill, and a silently missing
 * relation here shows up as an empty dropdown rather than an error.
 */
const STUDENT_ROW_SELECT = {
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
} satisfies Prisma.StudentProfileSelect;

export type StudentRow = Awaited<ReturnType<typeof getStudentForEdit>>;

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

/**
 * The half-open range covering one local calendar day.
 *
 * Parsed as a local date, not UTC midnight: a trip recorded at 7:40 in the evening
 * belongs to that day where the bus actually was, and `new Date("2026-10-03")`
 * would file it under the previous one for anyone east of Greenwich.
 *
 * One function, because the list and the tile counts have to agree on which rows
 * belong to the day. A tile counting UTC-midnight-to-UTC-midnight against a list
 * counting local midnight would disagree by a few rows at the edges, and the
 * disagreement would look like missing trips.
 */
function localDay(date?: string): { gte: Date; lt: Date } | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const start = new Date(y, m - 1, d);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}

export async function listTrips(filter?: {
  date?: string;
  status?: string;
  page?: RawPage;
}) {
  const where: Prisma.TripWhereInput = {
    date: localDay(filter?.date),
    status: filter?.status
      ? (filter.status as "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED")
      : undefined,
  };

  /*
   * Paged, and counted first.
   *
   * This took 100 rows with no count. A real fleet runs five buses on two routes
   * across a week, so a week view crosses a hundred easily - and the trips past it
   * were not shown, not marked as missing, and not reachable from the page.
   *
   * `id` is appended to the sort for the reason in `withIdOrder`: a bus running
   * the same route at the same time on the same date has two rows tying on both
   * `{date, scheduledStart}`, and an order that does not break the tie lets a trip
   * appear on page 1 and page 2 at once.
   */
  const { rows, page } = await paged({
    raw: filter?.page,
    perPage: 25,
    count: () => prisma.trip.count({ where }),
    rows: ({ skip, take }) =>
      prisma.trip.findMany({
        where,
        orderBy: [{ date: "desc" }, { scheduledStart: "asc" }, { id: "asc" }],
        skip,
        take,
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
      }),
  });

  return { trips: rows, page };
}

/**
 * Trip counts per status for one date, for the tiles above the list.
 *
 * Separate from `listTrips` because a tile cannot be computed from a page of rows.
 * It used to be `trips.filter(t => t.status === "ONGOING").length` over the hundred
 * the list happened to fetch, so the "On the road" figure was the number of
 * ongoing trips among the hundred most recent - and a fleet with more than a
 * hundred runs in a day showed "0 ongoing" while buses were moving.
 */
export async function countTripsByStatus(date?: string) {
  const grouped = await prisma.trip.groupBy({
    // By date only, never by status: these are the tiles *above* the status
    // filter, so they describe the whole day. Filtering them by the selected
    // status would make the "On the road" tile read zero while you are looking at
    // the Completed filter.
    where: { date: localDay(date) },
    by: ["status"],
    _count: { _all: true },
  });

  const counts = { SCHEDULED: 0, ONGOING: 0, COMPLETED: 0, CANCELLED: 0 } as Record<
    TripStatus,
    number
  >;
  for (const row of grouped) counts[row.status] = row._count._all;
  return counts;
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
  // the admin can see the size of the roster before committing to it â€” a bus
  // with 40 enrolled students and nobody on a route stop is worth catching now.
  const expectedCount = await prisma.enrollment.count({
    where: { busId: trip.busId, direction: trip.direction, isActive: true },
  });

  return { trip, stops, counts, expectedCount };
}

export async function listAlerts(filter?: { status?: string; page?: RawPage }) {
  const statusFilter = filter?.status
    ? (filter.status.toUpperCase() as AlertStatus)
    : undefined;
  const where = { status: statusFilter };

  /*
   * Counted and paged in the database rather than filtered in memory.
   *
   * This used to fetch the newest 100 rows and let the page filter them with
   * `Array.filter`. Two things were wrong with that, and the second is the one
   * that mattered:
   *
   * 1. Rows past the hundred were never requested, so the list was quietly
   *    incomplete - and the entries that vanish are emergency alerts.
   * 2. The filter chips counted from the same hundred, so "Open (3)" was the
   *    number of open alerts *among the hundred most recent*, presented with the
   *    same confidence as a total. A number that is quietly the wrong number is
   *    worse than one that is visibly a sample.
   *
   * `statusCounts` comes from a `groupBy` over the whole table with no status
   * predicate, because a chip has to show what selecting it would give you - all
   * four counts are always all four statuses.
   */
  const { rows, page } = await paged({
    raw: filter?.page,
    perPage: 25,
    count: () => prisma.emergencyAlert.count({ where }),
    rows: ({ skip, take }) =>
      prisma.emergencyAlert.findMany({
        where,
        // `createdAt` alone is not a total order: two alerts raised in the same
        // millisecond have no defined relative position, so a row could land on
        // two pages or on none.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
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
      }),
  });

  const grouped = await prisma.emergencyAlert.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const statusCounts = Object.fromEntries(
    grouped.map((g) => [g.status, g._count._all]),
  ) as Record<AlertStatus, number>;

  const alerts = rows;

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

  return {
    alerts: alerts.map((a) => ({ ...a, bus: byId.get(a.busId) ?? null })),
    /** True totals per status, for the filter chips. */
    statusCounts,
    /** The pager's window, already clamped. */
    page,
  };
}
