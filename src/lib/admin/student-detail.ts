import "server-only";
import { prisma } from "@/lib/db";
import { dateWindow } from "./export-range";
import type { AttendanceStatus } from "@/lib/attendance-summary";

/**
 * One student's detail page: who they are, where they ride, and how that has
 * gone.
 *
 * Kept out of `@/lib/admin/queries` because that module returns whole collections
 * for list screens. This is a single-entity read with a date window on it, and
 * lumping it in would make the list queries harder to see, not easier.
 */
export async function getStudentDetail(id: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id },
    select: {
      id: true,
      enrollmentNo: true,
      department: true,
      yearOfStudy: true,
      user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
      guardians: {
        select: { id: true, parent: { select: { user: { select: { name: true, phone: true } } } } },
      },
      enrollments: {
        where: { isActive: true },
        orderBy: [{ direction: "asc" }, { academicYear: "desc" }],
        select: {
          id: true,
          direction: true,
          academicYear: true,
          createdAt: true,
          bus: {
            select: {
              id: true,
              busNumber: true,
              registrationNo: true,
              isSimulated: true,
              route: { select: { id: true, name: true, code: true } },
            },
          },
          stop: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!student) return null;

  /*
   * Ended assignments are fetched separately rather than as a second relation on
   * the profile, because Prisma has no way to select two different `where` filters
   * on the same relation in one query. Splitting costs one extra round trip on a
   * screen that makes one; encoding "active and ended" as a single query would
   * mean sorting the two sets in application code and losing the database's
   * `take: 10`.
   */
  const ended = await prisma.enrollment.findMany({
    where: { studentId: id, isActive: false },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      direction: true,
      academicYear: true,
      updatedAt: true,
      bus: { select: { busNumber: true } },
      stop: { select: { name: true } },
    },
  });

  return { ...student, endedEnrollments: ended };
}

export type StudentHistoryRow = {
  id: string;
  date: string;
  direction: string;
  status: AttendanceStatus;
  pickedAt: string | null;
  waitingMarkedAt: string | null;
  busNumber: string;
  registrationNo: string;
  routeName: string;
  stopName: string;
  tripId: string;
  tripStatus: string;
  driverName: string;
};

/**
 * One student's attendance rows, newest first.
 *
 * Joined out to the trip and bus in one query rather than looked up per row, so
 * this is a single round trip regardless of how long the history is. A student
 * with two years of attendance is thousands of rows; doing that as N+1 would be
 * the slowest screen in the admin.
 *
 * PENDING rows are included but flagged by the caller through `tripStatus`: a
 * row whose trip was never completed has not actually been missed yet, and
 * showing it as MISSED would tell a parent their child was left behind on a trip
 * that was cancelled an hour before it should have run.
 */
export async function getStudentAttendanceHistory(
  studentId: string,
  from: string,
  to: string,
): Promise<StudentHistoryRow[]> {
  const records = await prisma.pickupRecord.findMany({
    where: { studentId, trip: { date: dateWindow(from, to) } },
    orderBy: [{ trip: { date: "desc" } }, { trip: { direction: "asc" } }],
    select: {
      id: true,
      status: true,
      pickedAt: true,
      waitingMarkedAt: true,
      trip: {
        select: {
          id: true,
          date: true,
          direction: true,
          status: true,
          bus: { select: { busNumber: true, registrationNo: true } },
          route: { select: { name: true } },
          driver: { select: { name: true } },
        },
      },
      stop: { select: { name: true } },
    },
  });

  return records.map((r) => ({
    id: r.id,
    date: r.trip.date.toISOString().slice(0, 10),
    direction: r.trip.direction,
    status: r.status,
    pickedAt: r.pickedAt ? r.pickedAt.toISOString() : null,
    waitingMarkedAt: r.waitingMarkedAt ? r.waitingMarkedAt.toISOString() : null,
    busNumber: r.trip.bus.busNumber,
    registrationNo: r.trip.bus.registrationNo,
    routeName: r.trip.route.name,
    stopName: r.stop.name,
    tripId: r.trip.id,
    tripStatus: r.trip.status,
    driverName: r.trip.driver.name,
  }));
}