"use client";

/**
 * One attendance row: a student, their status, and the buttons that change it.
 *
 * A Client Component because every status change goes through an async Server
 * Action and the list has to update in place afterwards. Each row owns its own
 * `saving` flag so a slow round trip on one student does not lock the whole
 * screen — the driver is standing on a bus with twelve taps to make, and a
 * frozen checklist is worse than a slow one.
 */

import { useState, useTransition } from "react";
import { setPickupStatusByDriver, type PortalActionResult } from "@/app/actions/portal";
import { Badge } from "@/components/ui/primitives";
import { PickupStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export type ChecklistRow = {
  recordId: string;
  studentName: string;
  enrollmentNo: string;
  phone: string | null;
  status: string;
  pickedAt: string | null;
  /** Which stop on the route this student boards at. */
  stopId: string;
};

const TONE: Record<string, "emerald" | "amber" | "red" | "slate"> = {
  PENDING: "slate",
  WAITING: "amber",
  PICKED: "emerald",
  MISSED: "red",
  ABSENT: "red",
};

export function ChecklistRowView({
  tripId,
  row,
  readOnly = false,
}: {
  tripId: string;
  row: ChecklistRow;
  /** Parents and students see the same list but cannot change it. */
  readOnly?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Revalidation refreshes the list, but the visible row should not flicker
  // back to its old status while that happens — so keep an optimistic overlay.
  const [override, setOverride] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const status = override ?? row.status;

  async function set(next: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const previous = status;
    setOverride(next);

    const body = new FormData();
    body.set("recordId", row.recordId);
    body.set("tripId", tripId);
    body.set("status", next);

    let result: PortalActionResult;
    try {
      result = await setPickupStatusByDriver(body);
    } catch {
      result = { ok: false, error: "Could not reach the server." };
    }

    setSaving(false);
    if (result.ok) {
      // Keep the optimistic value; the refreshed row will match shortly.
      startTransition(() => {});
      return;
    }
    // Roll back, and say why. A status that silently reverts is how attendance
    // records start disagreeing with what the driver believes they tapped.
    setOverride(previous);
    setError(result.error);
  }

  const waiting = status === PickupStatus.WAITING;
  const picked = status === PickupStatus.PICKED;
  const missed = status === PickupStatus.MISSED;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-2 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{row.studentName}</p>
        <p className="truncate text-xs text-slate-500">
          {row.enrollmentNo}
          {waiting ? " · marked as waiting" : ""}
          {picked && row.pickedAt ? ` · picked at ${row.pickedAt}` : ""}
        </p>
        {error ? (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {readOnly ? (
        <Badge tone={TONE[status] ?? "slate"}>{status.toLowerCase()}</Badge>
      ) : (
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => void set(PickupStatus.PICKED)}
            disabled={saving || picked}
            aria-pressed={picked}
            className={cn(
              "btn-secondary px-2.5 py-1 text-xs",
              picked && "border-emerald-300 bg-emerald-50 text-emerald-800",
            )}
          >
            Picked
          </button>
          <button
            type="button"
            onClick={() => void set(PickupStatus.MISSED)}
            disabled={saving || missed}
            aria-pressed={missed}
            className={cn(
              "btn-secondary px-2.5 py-1 text-xs",
              missed && "border-red-300 bg-red-50 text-red-800",
            )}
          >
            Missed
          </button>
          {!picked && !missed ? (
            <button
              type="button"
              onClick={() => void set(PickupStatus.PENDING)}
              disabled={saving}
              className="btn-ghost px-2.5 py-1 text-xs"
            >
              Undo
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}
