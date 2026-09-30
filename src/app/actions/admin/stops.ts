"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/admin/guard";
import { describeWriteError, firstErrors, type ActionState } from "@/lib/admin/action-state";
import { readForm } from "@/lib/admin/fields";
import { stopFields } from "@/lib/admin/form-defs";
import { stopSchema } from "@/lib/validations";

/**
 * Stops are the physical pickup points. They are referenced by route stops,
 * enrolments, trip stop events and attendance rows, so this module is the
 * reference example for how the admin screens handle deletion: hard delete only
 * when nothing depends on the row, otherwise deactivate.
 */

export async function saveStop(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const id = String(formData.get("id") ?? "");
  const { values } = readForm(formData, stopFields);
  const isActive = formData.get("isActive") === "on";

  const parsed = stopSchema.safeParse(values);
  if (!parsed.success) return { errors: firstErrors(parsed.error) };

  try {
    if (id) {
      await prisma.stop.update({
        where: { id },
        data: {
          name: parsed.data.name,
          address: parsed.data.address || null,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          isActive,
        },
      });
    } else {
      await prisma.stop.create({
        data: {
          name: parsed.data.name,
          address: parsed.data.address || null,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          isActive,
        },
      });
    }
  } catch (error) {
    return { message: describeWriteError(error) };
  }

  revalidatePath("/admin/stops");
  redirect("/admin/stops?saved=1");
}

/** Hard delete. Refused when anything still points at this stop. */
export async function deleteStop(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const [routes, enrolments, events] = await Promise.all([
    prisma.routeStop.count({ where: { stopId: id } }),
    prisma.enrollment.count({ where: { stopId: id } }),
    prisma.stopEvent.count({ where: { stopId: id } }),
  ]);

  if (routes + enrolments + events > 0) {
    throw new Error(
      "This stop is in use. Deactivate it instead so past trips keep working.",
    );
  }

  await prisma.stop.delete({ where: { id } });
  revalidatePath("/admin/stops");
}

export async function toggleStopActive(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = String(formData.get("id") ?? "");
  const next = formData.get("next") === "true";
  await prisma.stop.update({ where: { id }, data: { isActive: next } });
  revalidatePath("/admin/stops");
}
