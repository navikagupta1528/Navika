"use server";

/**
 * Everything a driver, a student or a parent can do from a phone.
 *
 * These actions sit outside `app/actions/admin` on purpose: the guard is
 * different, and so is the threat model. The admin guard answers "is this an
 * admin?". Here every action answers "is this person *on this trip*", which is a
 * relationship check, not a role check. A driver assigned to bus A cannot mark
 * attendance on bus B's trip by posting a crafted form, because the rule checks
 * the trip's driver against the session before touching anything.
 *
 * Each one is four lines. All of the decision — including every Prisma query, and
 * therefore every way for this code to be valid TypeScript that throws at
 * runtime — lives in `@/lib/attendance`, which takes an explicit actor and has
 * no request in scope. That split is what makes the rules testable; see the
 * comment at the top of that file for the bug that motivated it.
 *
 * The only things kept here are the two things that genuinely need the request:
 * reading the cookie, and telling Next which caches are now stale.
 */

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/session";
import { Role } from "@/generated/prisma/enums";
import {
  setPickupStatus,
  closeStop,
  markWaiting as markWaitingOp,
  confirmPickupSafe as confirmPickupSafeOp,
  type OpResult,
} from "@/lib/attendance";

/** Reject rather than throw: a 500 tells a driver nothing about what to fix. */
export type PortalActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** The caller's session as the shape the operations expect, or a refusal. */
async function currentActor(): Promise<
  { userId: string; role: Role } | { ok: false; error: string }
> {
  const session = await readSession();
  if (!session) return { ok: false, error: "Please sign in again." };
  return { userId: session.userId, role: session.role as Role };
}

/**
 * Run an operation and refresh the pages it changed.
 *
 * The list of paths comes back from the operation rather than living here,
 * because only the operation knows what it touched. A wrapper that revalidated
 * a hardcoded list would drift the first time an operation learned to write
 * somewhere new.
 */
async function run(
  op: () => Promise<OpResult>,
): Promise<PortalActionResult> {
  const result = await op();
  if (!result.ok) return result;
  for (const path of result.revalidate) revalidatePath(path);
  return result.ok ? { ok: true, message: result.message } : result;
}

// ---------------------------------------------------------------------------
// Driver: attendance
// ---------------------------------------------------------------------------

/**
 * Record a student's status on a trip — picked, missed, or back to pending.
 *
 * The single write behind three different buttons in the driver UI.
 */
export async function setPickupStatusByDriver(
  formData: FormData,
): Promise<PortalActionResult> {
  const actor = await currentActor();
  if ("ok" in actor) return actor;

  return run(() =>
    setPickupStatus(actor, {
      recordId: text(formData, "recordId"),
      tripId: text(formData, "tripId"),
      status: text(formData, "status"),
    }),
  );
}

/** Mark everyone still outstanding at a stop as missed, as the bus pulls away. */
export async function closeStopByDriver(formData: FormData): Promise<PortalActionResult> {
  const actor = await currentActor();
  if ("ok" in actor) return actor;

  return run(() =>
    closeStop(actor, {
      tripId: text(formData, "tripId"),
      stopId: text(formData, "stopId"),
    }),
  );
}

// ---------------------------------------------------------------------------
// Student / parent: "I am waiting"
// ---------------------------------------------------------------------------

/** A student or guardian marks that they are at the stop. */
export async function markWaiting(formData: FormData): Promise<PortalActionResult> {
  const actor = await currentActor();
  if ("ok" in actor) return actor;

  return run(() =>
    markWaitingOp(actor, {
      tripId: text(formData, "tripId"),
      waiting: text(formData, "waiting") === "true",
    }),
  );
}

/**
 * A guardian confirms a child the bus left behind is safe.
 *
 * The single write behind the red card on the parent and student dashboards.
 * All of the rule — whose child this may be, and what state it must be in — lives
 * in `confirmPickupSafe` in `@/lib/attendance`, so it is exercised by the
 * tracking smoke suite rather than only by a hand-built form.
 */
export async function confirmPickupSafe(formData: FormData): Promise<PortalActionResult> {
  const actor = await currentActor();
  if ("ok" in actor) return actor;

  return run(() => confirmPickupSafeOp(actor, { recordId: text(formData, "recordId") }));
}
