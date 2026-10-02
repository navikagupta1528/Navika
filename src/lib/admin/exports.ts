import "server-only";
import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/utils";
import { dateWindow } from "./export-range";

/**
 * The queries behind the CSV exports.
 *
 * These return plain data and no formatting. CSV assembly lives in `@/lib/csv`,
 * and the route handler assembles it - so these queries stay reusable if a
 * print view or a scheduled email ever needs the same numbers, and the escaping
 * logic stays testable without a database.
 *
 * Range validation and the date-window maths live in `./export-range`, which has
 * no `server-only` import and is unit tested on its own. This file is the part
 * that needs the database; that one is the part that can be wrong quietly.
 *
 * Every query here takes an explicit date window. An unbounded attendance query
 * is a query that eventually times out in front of an admin who has just asked
 * for the whole academic year.
 */

export type ExportColumn = { key: string; label: string };

export { dateWindow, validateRange, MAX_EXPORT_DAYS } from "./export-range";

/**
 * The whole attendance register for a date range, one row per record.
 *
 * Ordered by date then bus then student name, because that is the order someone
 * scanning the sheet for one bus on one day will read it in. Ordered by id it
 * would be arbitrary and would shuffle between exports of the same data, which
 * makes two downloads impossible to diff.
 */
export const ATTENDANCE_COLUMNS: ExportColumn[] = [
  { key: "date", label: "Date" },
  { key: "direction", label: "Direction" },
  { key: "busNumber", label: "Bus" },
  { key: "registrationNo", label: "Registration" },
  { key: "route", label: "Route" },
  { key: "student", label: "Student" },
  { key: "enrollmentNo", label: "Enrolment No" },
  { key: "department", label: "Department" },
  { key: "yearOfStudy", label: "Year" },
  { key: "stop", label: "Stop" },
  { key: "status", label: "Status" },
  { key: "pickedAt", label: "Picked up at" },
];

export async function getAttendanceExportRows(from: string, to: string) {
  const records = await prisma.pickupRecord.findMany({
    where: { trip: { date: dateWindow(from, to) } },
    orderBy: [
      { trip: { date: "asc" } },
      { trip: { bus: { busNumber: "asc" } } },
      { student: { user: { name: "asc" } } },
    ],
    select: {
      status: true,
      pickedAt: true,
      waitingMarkedAt: true,
      student: {
        select: {
          enrollmentNo: true,
          department: true,
          yearOfStudy: true,
          user: { select: { name: true } },
        },
      },
      stop: { select: { name: true } },
      trip: {
        select: {
          date: true,
          direction: true,
          bus: { select: { busNumber: true, registrationNo: true } },
          route: { select: { name: true } },
        },
      },
    },
  });

  return records.map((r) => ({
    date: r.trip.date.toISOString().slice(0, 10),
    direction: r.trip.direction,
    busNumber: r.trip.bus.busNumber,
    registrationNo: r.trip.bus.registrationNo,
    route: r.trip.route.name,
    student: r.student.user.name,
    enrollmentNo: r.student.enrollmentNo,
    department: r.student.department ?? "",
    yearOfStudy: r.student.yearOfStudy ?? "",
    stop: r.stop.name,
    status: r.status,
    pickedAt: r.pickedAt ? formatTime(r.pickedAt) : "",
  }));
}

export const STUDENT_HISTORY_COLUMNS: ExportColumn[] = [
  { key: "date", label: "Date" },
  { key: "direction", label: "Direction" },
  { key: "busNumber", label: "Bus" },
  { key: "route", label: "Route" },
  { key: "stop", label: "Stop" },
  { key: "status", label: "Status" },
  { key: "pickedAt", label: "Picked up at" },
  { key: "waitedFrom", label: "Announced waiting at" },
];

/**
 * One student's own attendance history.
 *
 * Returns the student alongside the rows rather than just the rows, because the
 * caller needs the name to name the file. An admin exporting histories for a
 * class gets a Downloads folder of `history-1.csv`, `history-2.csv`, and after
 * the fourth one there is no way to tell which child a file is about.
 *
 * A student with no records in the window still resolves - they come back with
 * an empty `rows` array, which is a real answer. Only a student id that does not
 * exist at all comes back as `null`.
 */
export async function getStudentHistoryExportRows(
  studentId: string,
  from: string,
  to: string,
): Promise<{
  student: { id: string; name: string; enrollmentNo: string };
  rows: Record<string, string>[];
} | null> {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: { id: true, enrollmentNo: true, user: { select: { name: true } } },
  });
  if (!student) return null;

  const records = await prisma.pickupRecord.findMany({
    where: { studentId, trip: { date: dateWindow(from, to) } },
    orderBy: { trip: { date: "desc" } },
    select: {
      status: true,
      pickedAt: true,
      waitingMarkedAt: true,
      stop: { select: { name: true } },
      trip: {
        select: {
          date: true,
          direction: true,
          bus: { select: { busNumber: true } },
          route: { select: { name: true } },
        },
      },
    },
  });

  return {
    student: {
      id: student.id,
      name: student.user.name,
      enrollmentNo: student.enrollmentNo,
    },
    rows: records.map((r) => ({
      date: r.trip.date.toISOString().slice(0, 10),
      direction: r.trip.direction,
      busNumber: r.trip.bus.busNumber,
      route: r.trip.route.name,
      stop: r.stop.name,
      status: r.status,
      pickedAt: r.pickedAt ? formatTime(r.pickedAt) : "",
      waitedFrom: r.waitingMarkedAt ? formatTime(r.waitingMarkedAt) : "",
    })),
  };
}

export const TRIP_ROSTER_COLUMNS: ExportColumn[] = [
  { key: "seq", label: "#" },
  { key: "student", label: "Student" },
  { key: "enrollmentNo", label: "Enrolment No" },
  { key: "department", label: "Department" },
  { key: "yearOfStudy", label: "Year" },
  { key: "phone", label: "Phone" },
  { key: "stop", label: "Stop" },
  { key: "status", label: "Status" },
  { key: "pickedAt", label: "Picked up at" },
];

/**
 * The manifest for one trip, in boarding order.
 *
 * This is the sheet a driver prints and takes on the bus, so it is ordered by
 * the order the student boards along the route - the sequence the driver's own
 * checklist uses - rather than by name. A manifest in the wrong order is a
 * manifest the driver works around by ignoring it.
 */
export async function getTripRosterExportRows(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      date: true,
      direction: true,
      status: true,
      bus: { select: { busNumber: true, registrationNo: true } },
      route: { select: { id: true, name: true } },
      driver: { select: { name: true } },
      pickupRecords: {
        select: {
          status: true,
          pickedAt: true,
          stopId: true,
          stop: { select: { name: true } },
          student: {
            select: {
              enrollmentNo: true,
              department: true,
              yearOfStudy: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      },
    },
  });

  if (!trip) return null;

  /*
   * Boarding order is the order of the stops along this route, which lives on
   * RouteStop rather than on the Stop.
   *
   * The obvious shortcut - ordering by `stop.routeStops._count` - is wrong and
   * quietly so: that counts how many routes a stop is on, so a terminus shared by
   * three routes sorts after a stop that is on exactly one. The manifest would
   * come out in an order that is merely plausible, which is worse than an
   * obviously wrong one, because a driver would still try to follow it.
   */
  const sequence = await prisma.routeStop.findMany({
    where: { routeId: trip.route.id },
    orderBy: { stopOrder: "asc" },
    select: { stopId: true },
  });
  const boardOrder = new Map(sequence.map((s, index) => [s.stopId, index]));

  const ordered = [...trip.pickupRecords].sort((a, b) => {
    // A stop missing from the route (a stop reassigned mid-term) sorts to the
    // end rather than interleaving at an arbitrary position.
    const byStop =
      (boardOrder.get(a.stopId) ?? Number.MAX_SAFE_INTEGER) -
      (boardOrder.get(b.stopId) ?? Number.MAX_SAFE_INTEGER);
    if (byStop !== 0) return byStop;
    return a.student.user.name.localeCompare(b.student.user.name);
  });

  const rows = ordered.map((r, index) => ({
    seq: index + 1,
    student: r.student.user.name,
    enrollmentNo: r.student.enrollmentNo,
    department: r.student.department ?? "",
    yearOfStudy: r.student.yearOfStudy ?? "",
    phone: r.student.user.phone ?? "",
    stop: r.stop.name,
    status: r.status,
    pickedAt: r.pickedAt ? formatTime(r.pickedAt) : "",
  }));

  return {
    trip,
    rows,
    columns: TRIP_ROSTER_COLUMNS,
    filename: `navika-manifest-${trip.bus.busNumber}-${trip.date.toISOString().slice(0, 10)}-${trip.direction.toLowerCase()}.csv`,
  };
}
