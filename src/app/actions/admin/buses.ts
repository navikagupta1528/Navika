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
import { busFields } from "@/lib/admin/form-defs";
import { busSchema } from "@/lib/validations";
import { generateDeviceToken } from "@/lib/device-token";
import { BusStatus } from "@/generated/prisma/enums";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function saveBus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const id = text(formData, "id");
  const { values } = readForm(formData, busFields);

  const parsed = busSchema.safeParse(values);
  if (!parsed.success) return { errors: firstErrors(parsed.error) };

  const routeId = parsed.data.routeId || null;
  const status = (text(formData, "status") || BusStatus.ACTIVE) as BusStatus;

  if (routeId) {
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      select: { isActive: true, name: true },
    });
    if (!route) return { errors: { routeId: "That route no longer exists" } };
    if (!route.isActive) {
      return {
        errors: { routeId: `"${route.name}" is inactive. Activate it first.` },
      };
    }
  }

  const data = {
    busNumber: parsed.data.busNumber,
    registrationNo: parsed.data.registrationNo,
    capacity: parsed.data.capacity,
    model: parsed.data.model || null,
    routeId,
    status,
  };

  try {
    if (id) {
      await prisma.bus.update({ where: { id }, data });
    } else {
      await prisma.bus.create({ data });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        errors: {
          busNumber: "That bus number is already in use",
          registrationNo: "That registration number is already in use",
        },
      };
    }
    return { message: describeWriteError(error) };
  }

  revalidatePath("/admin/buses");
  redirect("/admin/buses?saved=1");
}

export async function deleteBus(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  const [trips, enrolments] = await Promise.all([
    prisma.trip.count({ where: { busId: id } }),
    prisma.enrollment.count({ where: { busId: id, isActive: true } }),
  ]);

  if (trips > 0) {
    throw new Error(
      "This bus has run trips, so its history is permanent. Set it to inactive instead.",
    );
  }
  if (enrolments > 0) {
    throw new Error(
      "Students are still assigned to this bus. Move them to another bus first.",
    );
  }

  await prisma.bus.delete({ where: { id } });
  revalidatePath("/admin/buses");
}

export async function setBusStatus(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  const status = text(formData, "status") as BusStatus;
  if (!id || !Object.values(BusStatus).includes(status)) return;
  await prisma.bus.update({ where: { id }, data: { status } });
  revalidatePath("/admin/buses");
}

/** Attach a driver to a bus. Closes any other primary assignment for that bus. */
export async function assignBusDriver(formData: FormData): Promise<void> {
  await assertAdmin();
  const busId = text(formData, "busId");
  const driverId = text(formData, "driverId");
  const isPrimary = formData.get("isPrimary") === "on";
  if (!busId || !driverId) return;

  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: "DRIVER", isActive: true },
    select: { id: true },
  });
  if (!driver) throw new Error("That driver is not an active driver account.");

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.busDriver.updateMany({
        where: { busId, validTo: null, isPrimary: true },
        data: { validTo: now },
      });
    }
    await tx.busDriver.create({
      data: { busId, driverId, isPrimary, validFrom: now },
    });
  });

  revalidatePath(`/admin/buses/${busId}`);
  redirect(`/admin/buses/${busId}?driver=1`);
}

/** End a driver's assignment without deleting the row, preserving history. */
export async function unassignBusDriver(formData: FormData): Promise<void> {
  await assertAdmin();
  const assignmentId = text(formData, "assignmentId");
  const busId = text(formData, "busId");
  if (!assignmentId) return;

  await prisma.busDriver.update({
    where: { id: assignmentId },
    data: { validTo: new Date() },
  });

  revalidatePath(`/admin/buses/${busId}`);
}

/**
 * Mint a tracker token for a bus.
 *
 * Returns the plaintext in the action state, which the panel shows once and then
 * cannot retrieve again: the database only ever holds the hash. That is the same
 * bargain every API-token screen makes, and the reason the panel says so in as
 * many words - an admin who navigates away without copying it has to revoke and
 * reissue, and needs to know that before it happens.
 *
 * A separate row per token rather than overwriting a column, so fitting a second
 * tracker does not silently break the first.
 */
export async function createBusDevice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const busId = text(formData, "busId");
  const label = text(formData, "label") || "Tracker";
  if (!busId) return { errors: { label: "Missing bus." } };
  if (label.length > 60) {
    return { errors: { label: "Keep the label under 60 characters." } };
  }

  const bus = await prisma.bus.findUnique({ where: { id: busId }, select: { id: true } });
  if (!bus) return { errors: { label: "That bus no longer exists." } };

  const { token, hash } = generateDeviceToken();
  await prisma.busDevice.create({ data: { busId, label, tokenHash: hash } });

  revalidatePath(`/admin/buses/${busId}`);
  return { ok: true, message: token };
}

/**
 * Revoke a tracker token.
 *
 * Soft, not a delete: the row is kept so the panel can still show that the
 * device existed and when it stopped being trusted. A hard delete would leave an
 * admin staring at a token that simply vanished, with nothing to explain why the
 * tracker stopped reporting.
 */
export async function revokeBusDevice(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  const busId = text(formData, "busId");
  if (!id) return;

  await prisma.busDevice.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  revalidatePath(`/admin/buses/${busId}`);
}
