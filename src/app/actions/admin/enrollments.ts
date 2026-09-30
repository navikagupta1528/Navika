"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/admin/guard";
import {
  describeWriteError,
  firstErrors,
  isUniqueViolation,
  type ActionState,
} from "@/lib/admin/action-state";
import { readForm } from "@/lib/admin/fields";
import { enrollmentSchema } from "@/lib/validations";
import { Direction } from "@/generated/prisma/enums";

/**
 * The student -> bus -> stop assignment.
 *
 * This is the most important write in the system: it is what decides who rides
 * which bus, and it is what generates the attendance rows for every trip. So it
 * validates the whole chain — the stop has to belong to the bus's route,
 * otherwise the bus would "stop" somewhere it never drives.
 */

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function saveEnrollment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const id = text(formData, "id");
  // The field list is repeated here rather than imported from form-defs because
  // the enrolment form is rendered by a dedicated client component with its own
  // dependent stop dropdown; these are the same five names, read the same way.
  const { values } = readForm(formData, [
    { kind: "select", name: "studentId", label: "Student", options: [] },
    { kind: "select", name: "busId", label: "Bus", options: [] },
    { kind: "select", name: "stopId", label: "Pickup stop", options: [] },
    { kind: "select", name: "direction", label: "Direction", options: [] },
    { kind: "text", name: "academicYear", label: "Academic year" },
  ]);
  const parsed = enrollmentSchema.safeParse(values);
  if (!parsed.success) return { errors: firstErrors(parsed.error) };
  const data = parsed.data;

  const [student, bus, stop] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { id: data.studentId },
      select: { id: true, enrollmentNo: true, user: { select: { isActive: true } } },
    }),
    prisma.bus.findUnique({
      where: { id: data.busId },
      select: { id: true, busNumber: true, status: true, routeId: true },
    }),
    prisma.stop.findUnique({
      where: { id: data.stopId },
      select: { id: true, name: true, isActive: true },
    }),
  ]);

  if (!student) return { errors: { studentId: "Student not found" } };
  if (!bus) return { errors: { busId: "Bus not found" } };
  if (!stop) return { errors: { stopId: "Stop not found" } };

  if (!student.user.isActive) {
    return { errors: { studentId: "That student's login is deactivated" } };
  }
  if (bus.status === "INACTIVE") {
    return {
      errors: { busId: `Bus ${bus.busNumber} is inactive. Pick another bus.` },
    };
  }
  if (!stop.isActive) {
    return { errors: { stopId: "That stop is deactivated" } };
  }
  if (!bus.routeId) {
    return {
      errors: {
        busId: `Bus ${bus.busNumber} has no route assigned, so it has no stops. Give it a route first.`,
      },
    };
  }

  const onRoute = await prisma.routeStop.findUnique({
    where: { routeId_stopId: { routeId: bus.routeId, stopId: stop.id } },
    select: { id: true },
  });
  if (!onRoute) {
    return {
      errors: {
        stopId: `"${stop.name}" is not on this bus's route, so the bus will never stop there.`,
      },
    };
  }

  // One active assignment per student, per direction, per academic year: a
  // student cannot be on two different buses for the same journey.
  const clash = await prisma.enrollment.findFirst({
    where: {
      studentId: data.studentId,
      direction: data.direction as Direction,
      academicYear: data.academicYear,
      isActive: true,
      ...(id ? { id: { not: id } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    return {
      message: `That student already has an active ${data.direction.toLowerCase()} assignment for ${data.academicYear}. Remove it first to move them.`,
    };
  }

  // An assignment that was ended earlier still occupies the unique key
  // (student, bus, stop, direction, year). Creating a new row would trip that
  // constraint, so the honest result is to bring the old row back — which is
  // what the admin meant by re-adding the same thing.
  const revived = !id
    ? await prisma.enrollment.findFirst({
        where: {
          studentId: data.studentId,
          busId: data.busId,
          stopId: data.stopId,
          direction: data.direction as Direction,
          academicYear: data.academicYear,
          isActive: false,
        },
        select: { id: true },
      })
    : null;

  try {
    if (id) {
      await prisma.enrollment.update({
        where: { id },
        data: {
          studentId: data.studentId,
          busId: data.busId,
          stopId: data.stopId,
          direction: data.direction as Direction,
          academicYear: data.academicYear,
        },
      });
    } else if (revived) {
      await prisma.enrollment.update({
        where: { id: revived.id },
        data: { isActive: true },
      });
    } else {
      await prisma.enrollment.create({
        data: {
          studentId: data.studentId,
          busId: data.busId,
          stopId: data.stopId,
          direction: data.direction as Direction,
          academicYear: data.academicYear,
        },
      });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { message: "That exact assignment already exists." };
    }
    return { message: describeWriteError(error) };
  }

  revalidatePath("/admin/students");
  revalidatePath("/admin/buses");
  redirect("/admin/students?saved=1");
}

/**
 * End an enrolment.
 *
 * Deactivate rather than delete: the row is the link between a past trip's
 * attendance and the student, and deleting it would erase history.
 */
export async function endEnrollment(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;
  await prisma.enrollment.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/admin/students");
  revalidatePath("/admin/buses");
}

export async function reactivateEnrollment(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;
  await prisma.enrollment.update({ where: { id }, data: { isActive: true } });
  revalidatePath("/admin/students");
}

export async function deleteEnrollment(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  const used = await prisma.pickupRecord.count({ where: { enrollmentId: id } });
  if (used > 0) {
    throw new Error(
      "This assignment is already part of attendance history. End it instead of deleting it.",
    );
  }

  await prisma.enrollment.delete({ where: { id } });
  revalidatePath("/admin/students");
}

export async function toggleStudentActive(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  const next = formData.get("next") === "true";
  if (!id) return;
  await prisma.user.update({ where: { id }, data: { isActive: next } });
  revalidatePath("/admin/students");
}

/** Search students for the picker. Bounded so it cannot be used to dump the table. */
export async function searchStudents(query: string) {
  await assertAdmin();
  const q = query.trim();
  if (q.length < 2) return [];
  return prisma.studentProfile.findMany({
    where: {
      OR: [
        { user: { name: { contains: q, mode: "insensitive" } } },
        { enrollmentNo: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ],
    },
    take: 25,
    select: {
      id: true,
      enrollmentNo: true,
      user: { select: { name: true, email: true, isActive: true } },
    },
  });
}
