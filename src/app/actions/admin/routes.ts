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
import { isSameOrder, stopOrderPlan, validateReorder } from "@/lib/admin/route-order";
import { routeFields } from "@/lib/admin/form-defs";
import { routeSchema } from "@/lib/validations";

export async function saveRoute(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const id = String(formData.get("id") ?? "");
  const { values } = readForm(formData, routeFields);
  const isActive = formData.get("isActive") === "on";

  const parsed = routeSchema.safeParse(values);
  if (!parsed.success) return { errors: firstErrors(parsed.error) };

  try {
    if (id) {
      await prisma.route.update({
        where: { id },
        data: {
          name: parsed.data.name,
          code: parsed.data.code,
          description: parsed.data.description || null,
          isActive,
        },
      });
    } else {
      await prisma.route.create({
        data: {
          name: parsed.data.name,
          code: parsed.data.code,
          description: parsed.data.description || null,
          isActive,
        },
      });
    }
  } catch (error) {
    // The only expected failure here is a duplicate code, since name is not
    // unique but code is.
    if (isUniqueViolation(error)) {
      return { errors: { code: "That route code is already in use" } };
    }
    return { message: describeWriteError(error) };
  }

  revalidatePath("/admin/routes");
  redirect("/admin/routes?saved=1");
}

export async function deleteRoute(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const [buses, trips] = await Promise.all([
    prisma.bus.count({ where: { routeId: id } }),
    prisma.trip.count({ where: { routeId: id } }),
  ]);

  if (buses + trips > 0) {
    throw new Error(
      "This route has buses or trips on it. Detach them and deactivate the route instead.",
    );
  }

  // No students can be on this route's stops without a bus on it, so clearing
  // the join rows first is safe.
  await prisma.$transaction([
    prisma.routeStop.deleteMany({ where: { routeId: id } }),
    prisma.route.delete({ where: { id } }),
  ]);
  revalidatePath("/admin/routes");
}

export async function toggleRouteActive(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = String(formData.get("id") ?? "");
  const next = formData.get("next") === "true";
  await prisma.route.update({ where: { id }, data: { isActive: next } });
  revalidatePath("/admin/routes");
}

// ---------------------------------------------------------------------------
// Route stops: the ordered sequence, which is what makes a route a route
// ---------------------------------------------------------------------------

export async function addRouteStop(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  const stopId = String(formData.get("stopId") ?? "");
  const stopOrder = Number(formData.get("stopOrder") ?? 0);
  const scheduledHHMM = String(formData.get("scheduledHHMM") ?? "").trim();

  if (!routeId || !stopId) {
    return { errors: { stopId: "Choose a stop to add" } };
  }
  if (!Number.isInteger(stopOrder) || stopOrder < 1) {
    return { errors: { stopOrder: "Position must be a whole number of at least 1" } };
  }
  if (scheduledHHMM && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledHHMM)) {
    return { errors: { scheduledHHMM: "Use 24-hour HH:MM, e.g. 07:30" } };
  }

  try {
    await prisma.routeStop.create({
      data: {
        routeId,
        stopId,
        stopOrder,
        scheduledHHMM: scheduledHHMM || null,
      },
    });
  } catch (error) {
    return {
      message: describeWriteError(error).includes("already used")
        ? "That stop is already on this route, or another stop already holds that position."
        : describeWriteError(error),
    };
  }

  revalidatePath(`/admin/routes/${routeId}`);
  redirect(`/admin/routes/${routeId}?added=1`);
}

export async function updateRouteStop(formData: FormData): Promise<void> {
  await assertAdmin();
  const routeId = String(formData.get("routeId") ?? "");
  const id = String(formData.get("id") ?? "");
  const stopOrder = Number(formData.get("stopOrder") ?? 0);
  const scheduledHHMM = String(formData.get("scheduledHHMM") ?? "").trim();

  if (!Number.isInteger(stopOrder) || stopOrder < 1) return;
  if (scheduledHHMM && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledHHMM)) return;

  try {
    await prisma.routeStop.update({
      where: { id },
      data: {
        stopOrder,
        scheduledHHMM: scheduledHHMM || null,
      },
    });
  } catch (error) {
    console.error("[admin] route stop reorder failed:", error);
  }
  revalidatePath(`/admin/routes/${routeId}`);
}

/**
 * Remove a stop from a route.
 *
 * Enrolments pointing at this (route, stop) pair are blocked rather than
 * deleted: dropping the stop would silently orphan students. The admin has to
 * move them first, which is the honest outcome.
 */
export async function removeRouteStop(formData: FormData): Promise<void> {
  await assertAdmin();
  const routeId = String(formData.get("routeId") ?? "");
  const id = String(formData.get("id") ?? "");

  const routeStop = await prisma.routeStop.findUnique({
    where: { id },
    select: { stopId: true },
  });
  if (!routeStop) return;

  const used = await prisma.enrollment.count({
    where: { stopId: routeStop.stopId, isActive: true, bus: { routeId } },
  });

  if (used > 0) {
    throw new Error(
      `${used} student(s) are assigned to this stop on a bus of this route. Reassign them first.`,
    );
  }

  await prisma.routeStop.delete({ where: { id } });
  revalidatePath(`/admin/routes/${routeId}`);
}

/** Shift a stop one place up or down and renumber the ones it passes. */
export async function moveRouteStop(formData: FormData): Promise<void> {
  await assertAdmin();
  const routeId = String(formData.get("routeId") ?? "");
  const id = String(formData.get("id") ?? "");
  const direction = formData.get("direction") === "up" ? -1 : 1;

  const stops = await prisma.routeStop.findMany({
    where: { routeId },
    orderBy: { stopOrder: "asc" },
    select: { id: true, stopOrder: true },
  });
  const index = stops.findIndex((s) => s.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= stops.length) return;

  // Two steps, so the @@unique([routeId, stopOrder]) constraint is never
  // violated mid-transaction by two rows claiming the same position.
  const current = stops[index];
  const swap = stops[target];
  const slot = current.stopOrder;

  await prisma.$transaction([
    prisma.routeStop.update({ where: { id: current.id }, data: { stopOrder: -1 } }),
    prisma.routeStop.update({ where: { id: swap.id }, data: { stopOrder: slot } }),
    prisma.routeStop.update({ where: { id: current.id }, data: { stopOrder: swap.stopOrder } }),
  ]);

  revalidatePath(`/admin/routes/${routeId}`);
}

/**
 * Outcome of a drag-to-reorder.
 *
 * Returned rather than thrown because this action is invoked directly from a
 * client component, not through `useActionState`. A thrown Server Action error
 * reaches the browser as a generic failure in production — Next redacts the
 * message — so a validation problem would surface as "something went wrong"
 * with no way for the admin to tell what to fix.
 */
export type ReorderResult = { ok: true } | { ok: false; error: string };

/**
 * Set the whole stop sequence in one go.
 *
 * `moveRouteStop` swaps neighbours, which is the right shape for the up/down
 * buttons. Dragging a marker on the map is not a swap, so it needs an action
 * that writes the complete order.
 *
 * The submitted list must be a permutation of exactly the stops currently on
 * this route. That check is the whole point of the action: a stale browser tab
 * holding a stop that has since been removed, or a partial list from a
 * truncated request, would otherwise silently drop a student from the route.
 */
export async function reorderRouteStops(formData: FormData): Promise<ReorderResult> {
  await assertAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  const orderedIds = String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!routeId) return { ok: false, error: "Route not specified." };

  const current = await prisma.routeStop.findMany({
    where: { routeId },
    orderBy: { stopOrder: "asc" },
    select: { id: true, stopOrder: true },
  });

  const currentIds = current.map((s) => s.id);
  const check = validateReorder(current, orderedIds);
  if (!check.ok) return { ok: false, error: check.error };

  // Nothing to do. Skipping the write also avoids a pointless revalidate.
  if (isSameOrder(currentIds, check.order)) return { ok: true };

  const { park, assign } = stopOrderPlan(currentIds, check.order);

  try {
    await prisma.$transaction([
      ...park.map((s) =>
        prisma.routeStop.update({ where: { id: s.id }, data: { stopOrder: s.stopOrder } }),
      ),
      ...assign.map((s) =>
        prisma.routeStop.update({ where: { id: s.id }, data: { stopOrder: s.stopOrder } }),
      ),
    ]);
  } catch (error) {
    return { ok: false, error: describeWriteError(error) };
  }

  revalidatePath(`/admin/routes/${routeId}`);
  return { ok: true };
}
