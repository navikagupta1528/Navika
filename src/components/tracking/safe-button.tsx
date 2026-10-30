"use client";

/**
 * The red card: "the bus left without your child", and the one tap that closes it.
 *
 * This is the other half of the departure alert. The guardian has already been
 * told the bus left; this is what they do about it. It renders the whole card
 * rather than just a button because the card *is* the feature — the stop, the
 * bus, and the single action a parent can take at 7:40am — and duplicating
 * that copy in two dashboards is how the two versions drift apart.
 */

import { useState } from "react";
import { confirmPickupSafe, type PortalActionResult } from "@/app/actions/portal";
import { cn } from "@/lib/utils";

export type SafeButtonProps = {
  recordId: string;
  /** The student's name, so the card reads "Aarav was left at…" not "a student". */
  studentName: string;
  stopName: string;
  busLabel?: string;
  /** Guardians say "my child"; the student says "me". */
  perspective?: "guardian" | "student";
};

export function SafeButton({
  recordId,
  studentName,
  stopName,
  busLabel,
  perspective = "guardian",
}: SafeButtonProps) {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = studentName.split(" ")[0];
  const subject = perspective === "guardian" ? first : "You";
  const possessive = perspective === "guardian" ? "was" : "were";

  async function confirm() {
    if (busy || confirmed) return;
    setBusy(true);
    setError(null);

    const body = new FormData();
    body.set("recordId", recordId);

    let result: PortalActionResult;
    try {
      result = await confirmPickupSafe(body);
    } catch {
      result = { ok: false, error: "Could not reach the server." };
    }

    setBusy(false);
    if (result.ok) {
      setConfirmed(true);
      return;
    }
    setError(result.error);
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        confirmed
          ? "border-emerald-200 bg-emerald-50"
          : "border-red-200 bg-red-50",
      )}
      role={confirmed ? undefined : "alert"}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            confirmed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
          )}
        >
          {confirmed ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4.5 w-4.5">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4l2.3 2.3 6.3-6.3a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4.5 w-4.5">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-semibold",
              confirmed ? "text-emerald-900" : "text-red-900",
            )}
          >
            {confirmed
              ? `${subject} ${possessive === "was" ? "is" : "are"} safe`
              : `${subject} ${possessive} left at ${stopName}`}
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              confirmed ? "text-emerald-700" : "text-red-700",
            )}
          >
            {confirmed
              ? "The college office has been told."
              : `${busLabel ?? "The bus"} has left ${
                  perspective === "guardian" ? `${first}'s` : "your"
                } stop. Confirm ${
                  perspective === "guardian" ? "your child is" : "you are"
                } accounted for.`}
          </p>

          {!confirmed && (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className={cn(
                "mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white",
                "bg-red-600 hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600",
                busy && "opacity-60",
              )}
            >
              {busy ? "Confirming…" : perspective === "guardian" ? "My child is safe" : "I am safe"}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
