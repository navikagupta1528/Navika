/**
 * Stop-order validation for route reordering.
 *
 * Extracted from the Server Action for the same reason `osrm-parse` is separate
 * from `osrm`: the subtle part here is a correctness check with no I/O in it,
 * and that is exactly the part a smoke test cannot reach. The action is invoked
 * directly from a drag handler, not through a form, so there is no `$ACTION_*`
 * hidden input for an HTTP-level test to replay.
 */

/** The stops on a route, in their current visiting order. */
export type CurrentOrder = { id: string }[];

export type ReorderCheck =
  | { ok: true; order: string[] }
  | { ok: false; error: string };

/** The one message shown to the admin for any version mismatch. */
const STALE_MESSAGE =
  "The stop list changed while you were dragging. Reload the page and try the reorder again.";

/**
 * Check a submitted stop order against what is actually stored.
 *
 * The submitted list must be a permutation of exactly the stops currently on the
 * route: same members, none repeated, none missing. This is the whole safety
 * property of the action, because the write that follows cannot express the
 * difference between "reorder these" and "delete that one".
 *
 * Without it, a stale browser tab holding a stop that has since been removed
 * from the route would submit a list one shorter than the database, and the
 * write would quietly drop a student from their pickup. A duplicated id would
 * collide on `@@unique([routeId, stopOrder])` and fail the whole transaction
 * instead, which is at least loud.
 *
 * Returns the order unchanged on success so the caller cannot accidentally write
 * a different list than the one that was validated.
 */
export function validateReorder(
  current: CurrentOrder,
  orderedIds: string[],
): ReorderCheck {
  if (current.length === 0) {
    return { ok: false, error: "This route has no stops to reorder." };
  }

  if (!Array.isArray(orderedIds) || orderedIds.length !== current.length) {
    return { ok: false, error: STALE_MESSAGE };
  }

  const currentIds = new Set(current.map((s) => s.id));
  if (currentIds.size !== current.length) {
    // The stored order itself is inconsistent. Refusing is the only safe
    // response, because there is no correct answer to compute.
    return { ok: false, error: STALE_MESSAGE };
  }

  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!currentIds.has(id) || seen.has(id)) return { ok: false, error: STALE_MESSAGE };
    seen.add(id);
  }

  return { ok: true, order: [...orderedIds] };
}

/**
 * Whether a validated order actually changes anything.
 *
 * Purely an optimisation, but it also keeps `revalidatePath` from firing for a
 * drag that landed the marker back where it started, which is a gesture users
 * make by accident often enough to matter.
 */
export function isSameOrder(currentIds: string[], nextIds: string[]): boolean {
  return (
    currentIds.length === nextIds.length && currentIds.every((id, i) => id === nextIds[i])
  );
}

/**
 * The two-phase write plan for a reordering.
 *
 * Returns the negative parking slots first and the final 1..n assignments
 * second, which is what keeps `@@unique([routeId, stopOrder])` satisfied at
 * every step.
 *
 * Assigning the final positions directly would collide the moment two rows were
 * given positions that others still held: swapping stops 1 and 2 means row A
 * takes 2 while row B still has 2. Parking every row on a distinct negative
 * slot first empties the positive range, so no final assignment can collide.
 *
 * Returns the ids paired with the slot they should end up in, which is all the
 * caller needs to build the transaction and keeps this function free of Prisma.
 */
export function stopOrderPlan(
  currentIds: string[],
  order: string[],
): { park: { id: string; stopOrder: number }[]; assign: { id: string; stopOrder: number }[] } {
  return {
    // Enumerated from the stored order, not the submitted one, so the parking
    // slots stay unique even if the input is somehow malformed.
    park: currentIds.map((id, i) => ({ id, stopOrder: -(i + 1) })),
    assign: order.map((id, i) => ({ id, stopOrder: i + 1 })),
  };
}
