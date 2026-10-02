"use client";

/**
 * The emergency button.
 *
 * One button, held for a moment, no configuration. In a real incident the person
 * pressing it is a student who missed their bus or a driver with a puncture, and
 * anything that asks them to choose a category first is a reason the button does
 * not get pressed. The category defaults to EMERGENCY and the optional text is
 * there for whoever has a second to type.
 *
 * The hold is deliberate: it is the one destructive-ish action in the product
 * that cannot be undone, and it fires a push to every admin. A plain tap in a
 * pocket would page the whole office.
 */

import { useRef, useState, useTransition } from "react";
import { raiseAlert } from "@/app/actions/admin/alerts";
import { cn } from "@/lib/utils";

/** How long the button must be held. Long enough to be deliberate, short enough not to be a chore. */
const HOLD_MS = 700;

export function EmergencyButton({
  busNumber,
  showCategory = false,
}: {
  /** Which bus this report will be attached to, for the button's own wording. */
  busNumber?: string | null;
  showCategory?: boolean;
}) {
  const [state, setState] = useState<"idle" | "arming" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("EMERGENCY");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coords = useRef<{ lat: number; lng: number } | null>(null);

  /**
   * Best-effort position, read at the moment of pressing.
   *
   * Served from the cache on purpose: an emergency button that waits ten seconds
   * for a GPS lock is useless, and a fix up to a minute old still tells dispatch
   * which end of the route to look at. Called from the press handler rather than
   * from render, because this is a one-shot read and doing it during render
   * would re-fire on every re-render.
   */
  function readPosition(): void {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        coords.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 3_000 },
    );
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState("idle");
  }

  function begin() {
    if (state === "sent") return;
    readPosition();
    setState("arming");
    timer.current = setTimeout(() => {
      timer.current = null;
      void send();
    }, HOLD_MS);
  }

  async function send() {
    setError(null);
    const body = new FormData();
    body.set("message", message.trim() || `${busNumber ?? "Bus"} incident reported from the app`);
    body.set("type", type);
    if (coords.current) {
      body.set("lat", String(coords.current.lat));
      body.set("lng", String(coords.current.lng));
    }

    startTransition(async () => {
      const result = await raiseAlert(undefined, body);
      if (result?.ok) {
        setState("sent");
        setMessage("");
        return;
      }
      setState("error");
      setError(
        result?.message ??
          (result?.errors?.message ?? "Could not send the report."),
      );
    });
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-red-900">
            {busNumber ? `Report a problem on ${busNumber}` : "Report a problem"}
          </p>
          <p className="mt-0.5 text-xs text-red-700">
            Hold the button for a moment. Everyone watching this bus and the
            transport office are alerted.
          </p>
        </div>
      </div>

      {showCategory && state !== "sent" ? (
        <select
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="mt-3 w-full rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs"
          aria-label="Type of problem"
        >
          <option value="EMERGENCY">Emergency</option>
          <option value="BREAKDOWN">Breakdown</option>
          <option value="DELAY">Running late</option>
          <option value="OTHER">Something else</option>
        </select>
      ) : null}

      {state !== "sent" ? (
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Optional: what happened"
          maxLength={200}
          className="mt-2 w-full rounded-lg border border-red-200 bg-white px-2.5 py-2 text-xs"
        />
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onPointerDown={begin}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onKeyDown={(event) => {
            // Keyboard users get the same action on Space/Enter, held the same way.
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              begin();
            }
          }}
          onKeyUp={cancel}
          onBlur={cancel}
          disabled={state === "sent"}
          aria-label="Hold to send an emergency report"
          className={cn(
            "flex-1 select-none rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition",
            state === "sent" ? "bg-emerald-600" : "bg-red-600 hover:bg-red-700 active:bg-red-800",
          )}
        >
          {state === "arming"
            ? "Keep holding…"
            : state === "sent"
              ? "Reported"
              : "Hold to report"}
        </button>

        {state === "sent" ? (
          <button type="button" onClick={() => setState("idle")} className="btn-secondary text-xs">
            Report another
          </button>
        ) : null}
      </div>

      {/* Announced politely: a screen-reader user gets the outcome without the
          focus moving, which matters because the button may have vanished. */}
      <p className="sr-only" role="status">
        {state === "arming"
          ? "Keep holding to send the report."
          : state === "sent"
            ? "Report sent. The transport office has been alerted."
            : ""}
      </p>

      {error ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {state === "sent" ? (
        <p className="mt-2 text-xs text-emerald-800">
          Sent. The transport office has been alerted.
        </p>
      ) : null}
    </div>
  );
}
