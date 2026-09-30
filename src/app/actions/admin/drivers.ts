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
import { driverFields } from "@/lib/admin/form-defs";
import { driverSchema } from "@/lib/validations";
import { hashPassword } from "@/lib/auth-password";
import { Role } from "@/generated/prisma/enums";

/**
 * Admin-created driver accounts.
 *
 * Drivers cannot self-register — `registerSchema` only accepts STUDENT and
 * PARENT — so this is the only way a driver account comes into existence. It
 * therefore also generates the initial password rather than asking a human to
 * invent one over chat.
 */

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createDriver(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const id = text(formData, "id");
  const { values } = readForm(formData, driverFields);

  const parsed = driverSchema.safeParse(values);
  if (!parsed.success) return { errors: firstErrors(parsed.error) };
  const data = parsed.data;

  const licenseExpiry = data.licenseExpiry
    ? new Date(data.licenseExpiry)
    : null;

  try {
    if (id) {
      const password = data.password;
      await prisma.user.update({
        where: { id },
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          isActive: formData.get("isActive") === "on",
          ...(password
            ? { passwordHash: await hashPassword(password) }
            : {}),
          driverProfile: {
            update: {
              licenseNo: data.licenseNo,
              licenseExpiry,
              experienceYr: data.experienceYr ?? 0,
            },
          },
        },
      });
    } else {
      if (!data.password) {
        return {
          errors: { password: "Set an initial password for the driver" },
        };
      }
      await prisma.user.create({
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          role: Role.DRIVER,
          passwordHash: await hashPassword(data.password),
          driverProfile: {
            create: {
              licenseNo: data.licenseNo,
              licenseExpiry,
              experienceYr: data.experienceYr ?? 0,
            },
          },
        },
      });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        errors: {
          email: "A user already has that email address",
          licenseNo: "That licence number is already registered",
        },
      };
    }
    return { message: describeWriteError(error) };
  }

  revalidatePath("/admin/drivers");
  redirect("/admin/drivers?saved=1");
}

export async function toggleDriverActive(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  const next = formData.get("next") === "true";
  if (!id) return;

  // Deactivating a driver who is currently the primary on a bus would leave that
  // bus without a driver and every parent dashboard broken, so refuse.
  const assigned = await prisma.busDriver.count({
    where: { driverId: id, validTo: null },
  });
  if (!next && assigned > 0) {
    throw new Error(
      "This driver is still assigned to a bus. Unassign them before deactivating.",
    );
  }

  await prisma.user.update({ where: { id }, data: { isActive: next } });
  revalidatePath("/admin/drivers");
}

export async function deleteDriver(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  const trips = await prisma.trip.count({ where: { driverId: id } });
  if (trips > 0) {
    throw new Error(
      "This driver has driven trips, so their record must stay. Deactivate the account instead.",
    );
  }

  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/drivers");
}
