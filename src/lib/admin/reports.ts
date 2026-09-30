import "server-only";
import { prisma } from "@/lib/db";

/**
 * Attendance aggregates for the reports screen.
 *
 * Deliberately computed in the database rather than by loading every
 * PickupRecord: a full academic year of attendance is one row per student per
 * trip per direction, which is easily six figures, and no browser should ever
 * receive that.
 */

export type AttendanceReport = {
  from: string;
  to: string;
  totals: {
    picked: number;
    missed: number;
    waiting: number;
    pending: number;
    absent: number;
    trips: number;
  };
  byBus: {
    busId: string;
    busNumber: string;
    registrationNo: string;
    routeName: string | null;
    trips: number;
    picked: number;
    missed: number;
  }[];
  /** Students who were left behind most often — the list an admin acts on. */
  chronic: {
    studentId: string;
    name: string;
    enrollmentNo: string;
    busNumber: string;
    missed: number;
    picked: number;
  }[];
  daily: { date: string; picked: number; missed: number; trips: number }[];
};

/** Trip.date is a `date` column, so a local-midnight range is correct here. */
function range(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return {
    gte: new Date(fy, fm - 1, fd),
    lt: new Date(ty, tm - 1, td + 1),
  };
}

export async function getAttendanceReport(
  from: string,
  to: string,
): Promise<AttendanceReport> {
  const where = { date: range(from, to) };

  const [tripRows, missedByStudent] = await Promise.all([
    prisma.trip.findMany({
      where,
      select: {
        id: true,
        date: true,
        status: true,
        bus: {
          select: {
            id: true,
            busNumber: true,
            registrationNo: true,
            route: { select: { name: true } },
          },
        },
        pickupRecords: { select: { status: true } },
      },
    }),
    prisma.pickupRecord.groupBy({
      by: ["studentId"],
      where: {
        status: { in: ["MISSED", "ABSENT"] },
        trip: where,
      },
      _count: { _all: true },
      orderBy: { _count: { studentId: "desc" } },
      take: 20,
    }),
  ]);

  const totals = {
    picked: 0,
    missed: 0,
    waiting: 0,
    pending: 0,
    absent: 0,
    trips: tripRows.filter((t) => t.status === "COMPLETED").length,
  };

  const busMap = new Map<
    string,
    { busId: string; busNumber: string; registrationNo: string; routeName: string | null; trips: number; picked: number; missed: number }
  >();
  const dayMap = new Map<string, { date: string; picked: number; missed: number; trips: number }>();

  for (const trip of tripRows) {
    const day = trip.date.toISOString().slice(0, 10);
    const dayRow = dayMap.get(day) ?? { date: day, picked: 0, missed: 0, trips: 0 };
    if (trip.status === "COMPLETED") dayRow.trips++;

    for (const record of trip.pickupRecords) {
      if (record.status === "PICKED") {
        totals.picked++;
        dayRow.picked++;
      } else if (record.status === "MISSED") {
        totals.missed++;
        dayRow.missed++;
      } else if (record.status === "WAITING") totals.waiting++;
      else if (record.status === "ABSENT") totals.absent++;
      else totals.pending++;
    }

    const bus = busMap.get(trip.bus.id) ?? {
      busId: trip.bus.id,
      busNumber: trip.bus.busNumber,
      registrationNo: trip.bus.registrationNo,
      routeName: trip.bus.route?.name ?? null,
      trips: 0,
      picked: 0,
      missed: 0,
    };
    if (trip.status === "COMPLETED") bus.trips++;
    for (const record of trip.pickupRecords) {
      if (record.status === "PICKED") bus.picked++;
      else if (record.status === "MISSED") bus.missed++;
    }
    busMap.set(trip.bus.id, bus);

    dayMap.set(day, dayRow);
  }

  // Fill in the student names for the chronic-missed list.
  const studentIds = missedByStudent.map((m) => m.studentId);
  const students = await prisma.studentProfile.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      enrollmentNo: true,
      user: { select: { name: true } },
      enrollments: {
        where: { isActive: true },
        take: 1,
        select: { bus: { select: { busNumber: true } } },
      },
    },
  });
  const studentMap = new Map(students.map((s) => [s.id, s]));

  const chronic = missedByStudent
    .map((m) => {
      const student = studentMap.get(m.studentId);
      if (!student) return null;
      return {
        studentId: m.studentId,
        name: student.user.name,
        enrollmentNo: student.enrollmentNo,
        busNumber: student.enrollments[0]?.bus.busNumber ?? "—",
        missed: m._count._all,
        picked: 0,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.missed - a.missed);

  return {
    from,
    to,
    totals,
    byBus: [...busMap.values()].sort((a, b) => b.picked - a.picked),
    chronic,
    daily: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
