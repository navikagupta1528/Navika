"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/admin/guard";
import { describeWriteError, type ActionState } from "@/lib/admin/action-state";
import { readSession } from "@/lib/session";
import { Role } from "@/generated/prisma/enums";
import { raiseAlert as raiseAlertOp } from "@/lib/attendance";

/**
 * Alert review, and the actions that *raise* alerts.
 *
 * The status flow is the important part: an alert is never deleted, only
 * acknowledged and then resolved, so there is always a record of who knew about
 * an emergency and when. Raising is open to all four roles — a student stranded
 * at a stop and a driver with a puncture both need to press the button, and an
 * emergency that has to be phoned to the office first is an emergency that
 * arrives too late.
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

// ---------------------------------------------------------------------------
// Raising
// ---------------------------------------------------------------------------

/**
 * Raise an alert against the caller's own trip.
 *
 * The trip is not trusted from the form: it is resolved from the caller's own
 * bus or child, so the alert is always attached to something the person was
 * actually on. A crafted `tripId` would otherwise let anyone attach a panic
 * button to somebody else's bus, which turns the emergency channel into a
 * spam vector.
 *
 * Coordinates, when given, are the reporter's own position from the browser.
 * They are stored unverified and labelled as such — a student's fix from a
 * basement is worth recording with a location, but not worth dispatching a van
 * to on its own.
 */
export async function raiseAlert(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await readSession();
  if (!session) return { ok: false, message: "Please sign in again." };

  // The rule, the queries, and the fan-out all live in `@/lib/attendance`. Only
  // the cookie and the cache invalidation need this request, so only those are
  // here — which is also what lets `scripts/smoke-tracking.ts` exercise the
  // authorization without a browser.
  try {
    const result = await raiseAlertOp(
      { userId: session.userId, role: session.role as Role },
      {
        message: text(formData, "message"),
        type: text(formData, "type"),
        lat: text(formData, "lat"),
        lng: text(formData, "lng"),
      },
    );

    if (!result.ok) {
      // A too-short message is the caller's to fix, so it comes back as a field
      // error on the box they typed into rather than as a page-level message.
      if (result.error.startsWith("Say what")) {
        return { ok: false, errors: { message: result.error } };
      }
      return { ok: false, message: result.error };
    }

    revalidatePath("/admin/alerts");
    revalidatePath("/driver");
    revalidatePath("/fleet");
    return { ok: true, message: "Reported. The transport office has been alerted." };
  } catch (error) {
    return { ok: false, message: describeWriteError(error) };
  }
}
