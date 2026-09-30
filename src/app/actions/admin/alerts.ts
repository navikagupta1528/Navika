"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/admin/guard";
import { describeWriteError } from "@/lib/admin/action-state";

/**
 * Alert handling.
 *
 * Alerts are raised by drivers, students and parents in Phase 3, so this screen
 * is mostly the review queue. The important part is the status flow: an alert is
 * never deleted, only acknowledged and then resolved, so there is always a
 * record of who knew about an emergency and when.
 */

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function acknowledgeAlert(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  await prisma.emergencyAlert.updateMany({
    // Guarded by status in the query as well, so a double click cannot
    // overwrite an acknowledgement timestamp that is already set.
    where: { id, status: "OPEN" },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
  });

  revalidatePath("/admin/alerts");
}

export async function resolveAlert(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  const note = text(formData, "note");
  if (!id) return;

  try {
    await prisma.emergencyAlert.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolutionNote: note || null,
      },
    });
  } catch (error) {
    console.error("[admin] resolve alert failed:", error);
    throw new Error(describeWriteError(error));
  }

  revalidatePath("/admin/alerts");
  revalidatePath("/admin");
}

export async function reopenAlert(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, "id");
  if (!id) return;

  await prisma.emergencyAlert.update({
    where: { id },
    data: {
      status: "OPEN",
      acknowledgedAt: null,
      resolvedAt: null,
      resolvedById: null,
    },
  });

  revalidatePath("/admin/alerts");
}
