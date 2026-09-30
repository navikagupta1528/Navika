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
import { tripSchema } from "@/lib/validations";
import {
  PickupStatus,
  TripDirection,
  TripStatus,
} from "@/generated/prisma/enums";

/**
 * Trip scheduling and the attendance that hangs off it.
 *
 * THE KEY OPERATION IS `startTrip`. Starting a trip materialises one
 * `PickupRecord` per active enrolment on that bus for that direction. Until
 * that happens there is no attendance to record, which is why the driver
 * screen and the parent screen both key off the trip's status rather than off
 * the enrolment table directly.
 */

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Combine a `YYYY-MM-DD` date with an `HH:MM` time in the server's zone. */
function combine(date: string, time: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export async function scheduleTrip(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const { values } = readForm(formData, [
    { kind: "date", name: "date", label: "Date" },
    { kind: "time", name: "scheduledStart", label: "Start" },
    { kind: "select", name: "busId", label: "Bus", options: [] },
    { kind: "select", name: "direction", label: "Direction", options: [] },
    { kind: "select", name: "driverId", label: "Driver", options: [] },
  ]);

  const parsed = tripSchema.safeParse(values);
  if (!parsed.success) return { errors: firstErrors(parsed.error) };
  const data = parsed.data;

  const bus = await prisma.bus.findUnique({
    where: { id: data.busId },
    select: {
      id: true,
      busNumber: true,
      status: true,
      routeId: true,
      route: { select: { _count: { select: { routeStops: true } } } },
    },
  });
  if (!bus) return { errors: { busId: "Bus not found" } };
  if (bus.status !== "ACTIVE") {
    return {
      errors: { busId: `Bus ${bus.busNumber} is not active` },
    };
  }
  if (!bus.routeId || bus.route?._count.routeStops === 0) {
    return {
      errors: { busId: `Bus ${bus.busNumber} has no route stops scheduled` },
    };
  }

  const driver = await prisma.user.findFirst({
    where: { id: data.driverId, role: "DRIVER", isActive: true },
    select: { id: true },
  });
  if (!driver) {
    return { errors: { driverId: "Choose an active driver" } };
  }

  const scheduledStart = combine(data.date, data.scheduledStart);
  if (!scheduledStart) {
    return { errors: { scheduledStart: "Enter a valid date and start time" } };
  }

  try {
    await prisma.trip.create({
      data: {
        busId: data.busId,
        routeId: bus.routeId,
        driverId: data.driverId,
        date: new Date(data.date),
        direction: data.direction as TripDirection,
        status: TripStatus.SCHEDULED,
        scheduledStart,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        message: `Bus ${bus.busNumber} already has a ${
          data.direction === "PICKUP" ? "pickup" : "drop-off"
        } trip on that date. Only one per direction per day.`,
      };
    }
    return { message: describeWriteError(error) };
  }

  revalidatePath("/admin/trips");
  redirect("/admin/trips?saved=1");
}

/**
 * Start a trip and generate its attendance sheet.
 *
 * Idempotent by design: running it twice must not duplicate rows, so the
 * attendance is only created for enrolments that do not already have a record
 * on this trip.
 */
export async function startTrip(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      busId: true,
      direction: true,
      startedAt: true,
      scheduledStart: true,
      bus: {
        select: {
          onboardCount: true,
          route: { select: { _count: { select: { routeStops: true } } } },
        },
      },
    },
  });
  if (!trip) return;
  if (trip.status === TripStatus.COMPLETED) {
    throw new Error("This trip has already finished and cannot be restarted.");
  }
  if (trip.status === TripStatus.CANCELLED) {
    throw new Error("This trip was cancelled. Schedule a new one instead.");
  }
  if (!trip.bus.route || trip.bus.route._count.routeStops === 0) {
    throw new Error("The bus route has no stops, so there is nothing to run.");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Attendance sheet: one row per active enrolment for this direction.
    const enrolments = await tx.enrollment.findMany({
      where: {
        busId: trip.busId,
        direction: trip.direction,
        isActive: true,
      },
      select: { id: true, studentId: true, stopId: true },
    });

    const existing = await tx.pickupRecord.findMany({
      where: { tripId: trip.id },
      select: { studentId: true, stopId: true },
    });
    const have = new Set(existing.map((r) => `${r.studentId}:${r.stopId}`));

    await tx.pickupRecord.createMany({
      data: enrolments
        .filter((e) => !have.has(`${e.studentId}:${e.stopId}`))
        .map((e) => ({
          tripId: trip.id,
          studentId: e.studentId,
          stopId: e.stopId,
          enrollmentId: e.id,
          status: PickupStatus.PENDING,
        })),
      skipDuplicates: true,
    });

    await tx.trip.update({
      where: { id: trip.id },
      data: {
        status: TripStatus.ONGOING,
        startedAt: trip.startedAt ?? now,
        // Delay is measured against the planned start, and only recorded the
        // first time, so a re-start cannot erase the real delay.
        delaySeconds: trip.startedAt
          ? undefined
          : Math.round((now.getTime() - trip.scheduledStart.getTime()) / 1000),
      },
    });

    await tx.bus.update({
      where: { id: trip.busId },
      data: { onboardCount: enrolments.length, status: "ACTIVE" },
    });
  });

  revalidatePath("/admin/trips");
  revalidatePath(`/admin/trips/${id}`);
  redirect(`/admin/trips/${id}?started=1`);
}

export async function completeTrip(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { id: true, status: true, busId: true, startedAt: true },
  });
  if (!trip || trip.status !== TripStatus.ONGOING) return;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Anyone left as PENDING or WAITING never got on the bus. Recording that
    // here is what makes "not picked up" a fact rather than a silence.
    await tx.pickupRecord.updateMany({
      where: { tripId: id, status: { in: [PickupStatus.PENDING, PickupStatus.WAITING] } },
      data: { status: PickupStatus.MISSED },
    });

    const picked = await tx.pickupRecord.count({
      where: { tripId: id, status: PickupStatus.PICKED },
    });

    await tx.trip.update({
      where: { id },
      data: { status: TripStatus.COMPLETED, endedAt: now },
    });

    await tx.bus.update({
      where: { id: trip.busId },
      data: { onboardCount: picked },
    });
  });

  revalidatePath("/admin/trips");
  revalidatePath(`/admin/trips/${id}`);
}

export async function cancelTrip(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { status: true, busId: true },
  });
  if (!trip || trip.status === TripStatus.COMPLETED) return;

  await prisma.$transaction([
    prisma.trip.update({
      where: { id },
      data: { status: TripStatus.CANCELLED },
    }),
    prisma.bus.update({ where: { id: trip.busId }, data: { onboardCount: 0 } }),
  ]);

  revalidatePath("/admin/trips");
  revalidatePath(`/admin/trips/${id}`);
}

export async function reassignTripDriver(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  const driverId = text(formData, "driverId");
  if (!id || !driverId) return;

  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: "DRIVER", isActive: true },
    select: { id: true },
  });
  if (!driver) throw new Error("That driver is not an active driver account.");

  await prisma.trip.update({ where: { id }, data: { driverId } });
  revalidatePath(`/admin/trips/${id}`);
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/** Set one student's status for this trip. The driver's primary action. */
export async function setPickupStatus(formData: FormData): Promise<void> {
  await assertAdmin();
  const recordId = text(formData, "recordId");
  const tripId = text(formData, "tripId");
  const status = text(formData, "status") as PickupStatus;

  if (!recordId || !tripId) return;
  if (!Object.values(PickupStatus).includes(status)) return;

  const now = new Date();
  const data =
    status === PickupStatus.PICKED
      ? { status, pickedAt: now, cancelledAt: null }
      : status === PickupStatus.MISSED || status === PickupStatus.ABSENT
        ? { status, cancelledAt: now }
        : { status, pickedAt: null };

  await prisma.pickupRecord.update({ where: { id: recordId }, data });

  // Keep the bus's onboard count in step with the check-ins.
  const picked = await prisma.pickupRecord.count({
    where: { tripId, status: PickupStatus.PICKED },
  });
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { busId: true },
  });
  if (trip) {
    await prisma.bus.update({
      where: { id: trip.busId },
      data: { onboardCount: picked },
    });
  }

  revalidatePath(`/admin/trips/${tripId}`);
}

/** Mark everyone still pending at a stop as missed, when the bus pulls away. */
export async function closeStop(formData: FormData): Promise<void> {
  await assertAdmin();
  const tripId = text(formData, "tripId");
  const stopId = text(formData, "stopId");
  if (!tripId || !stopId) return;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.pickupRecord.updateMany({
      where: {
        tripId,
        stopId,
        status: { in: [PickupStatus.PENDING, PickupStatus.WAITING] },
      },
      data: { status: PickupStatus.MISSED },
    });

    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      select: { startedAt: true, scheduledStart: true, busId: true },
    });
    if (!trip) return;

    const arrivedAt = now;
    const baseline = trip.startedAt ?? trip.scheduledStart;
    const delaySeconds = Math.max(
      0,
      Math.round((arrivedAt.getTime() - baseline.getTime()) / 1000),
    );

    const existing = await tx.stopEvent.findUnique({
      where: { tripId_stopId: { tripId, stopId } },
      select: { id: true },
    });

    if (existing) {
      await tx.stopEvent.update({
        where: { id: existing.id },
        data: { arrivedAt, departedAt: now, delaySeconds },
      });
    } else {
      await tx.stopEvent.create({
        data: { tripId, stopId, arrivedAt, departedAt: now, delaySeconds },
      });
    }

    const picked = await tx.pickupRecord.count({
      where: { tripId, status: PickupStatus.PICKED },
    });
    await tx.bus.update({
      where: { id: trip.busId },
      data: { onboardCount: picked },
    });
  });

  revalidatePath(`/admin/trips/${tripId}`);
}
