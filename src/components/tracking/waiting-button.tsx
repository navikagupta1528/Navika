"use client";

/**
 * "I'm waiting" — the one button that makes this student-aware.
 *
 * Everything else in Navika is about where the bus is. This is about the
 * student: they are standing at a stop, and the driver needs to know before
 * turning onto that road, not after blowing past them.
 */

import { useState } from "react";
import { markWaiting, type PortalActionResult } from "@/app/actions/portal";
import { cn } from "@/lib/utils";

export type WaitingButtonProps = {
  tripId: string;
  /** The server's current status, so the button starts in the right state. */
  initialStatus: string;
  /** What the driver will see. Null when the trip is not running. */
  tripRunning: boolean;
};

const COPY: Record<string, { label: string; hint: string; tone: string }> = {
  WAITING: {
    label: "You are marked as waiting",
    hint: "The driver sees your count for this stop. Tap again to cancel.",
    tone: "amber",
  },
  PICKED: {
    label: "Picked up",
    hint: "You are on the bus. Nothing more to do.",
    tone: "emerald",
  },
  MISSED: {
    label: "The bus has left",
    hint: "This stop has been closed for this trip.",
    tone: "red",
  },
  PENDING: {
    label: "I am at the stop",
    hint: "Let the driver know you are waiting here.",
    tone: "slate",
  },
};

export function WaitingButton({ tripId, initialStatus, tripRunning }: WaitingButtonProps) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = status === "PICKED" || status === "MISSED";
  const copy = COPY[status] ?? COPY.PENDING!;

  async function toggle() {
    if (busy || locked) return;
    const nextWaiting = status !== "WAITING";

    setBusy(true);
    setError(null);
    const previous = status;
    setStatus(nextWaiting ? "WAITING" : "PENDING");

    const body = new FormData();
    body.set("tripId", tripId);
    body.set("waiting", String(nextWaiting));

    let result: PortalActionResult;
    try {
      result = await markWaiting(body);
    } catch {
      result = { ok: false, error: "Could not reach the server." };
    }

    setBusy(false);
    if (result.ok) return;

    // Revert. A toggle that silently snaps back looks broken and teaches the
    // student not to trust the button.
    setStatus(previous);
    setError(result.error);
  }

  if (!tripRunning) {
    return (
      <p className="text-sm text-slate-600">
        The bus is not running yet. This button becomes active once your trip
        starts, so the driver does not see you waiting hours early.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy || locked}
        aria-pressed={status === "WAITING"}
        className={cn(
          "w-full text-sm font-medium",
          status === "WAITING" ? "btn-secondary border-amber-300 bg-amber-50 text-amber-900" : "btn-primary",
          locked && "opacity-60",
        )}
      >
        {busy ? "Sending…" : copy.label}
      </button>
      <p className="text-xs text-slate-500">{copy.hint}</p>
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
