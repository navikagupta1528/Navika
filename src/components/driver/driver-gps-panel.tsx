"use client";

/**
 * The driver's "share my location" control.
 *
 * Deliberately one button and a line of honest text. A driver on a moving bus
 * is not going to read a settings panel, and the one thing that must never be
 * ambiguous is whether the phone is currently reporting — a driver who thinks
 * they are sharing when they are not produces a bus that appears frozen on a
 * parent's map for twenty minutes.
 */

import { useDriverTracker } from "@/hooks/use-driver-tracker";
import { Badge, Card, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, "emerald" | "amber" | "red" | "slate"> = {
  idle: "slate",
  starting: "amber",
  sharing: "emerald",
  denied: "red",
  unavailable: "amber",
  insecure: "red",
  unsupported: "red",
  "no-bus": "amber",
  offline: "amber",
};

const REJECTION_TEXT: Record<string, string> = {
  "not-a-point": "that reading had no usable coordinates",
  "clock-too-old": "that reading was too old to be current",
  "clock-in-future": "that reading's clock is wrong",
  "too-inaccurate": "that reading was less precise than the one we already had",
  teleport: "that reading jumped too far to be real",
};

export function DriverGpsPanel({ busNumber }: { busNumber: string | null }) {
  const { status, fix, rejected, message, start, stop } = useDriverTracker();
  const sharing = status === "sharing" || status === "starting";
  const tone = STATUS_TONE[status] ?? "slate";

  const blocked = status === "denied" || status === "insecure" || status === "unsupported";

  return (
    <Card>
      <CardTitle
        hint={
          busNumber
            ? `Positions are published as ${busNumber}.`
            : "You need a bus assignment before your position can be published."
        }
        action={<Badge tone={tone}>{status === "starting" ? "connecting" : status}</Badge>}
      >
        Live location
      </CardTitle>

      <div className="space-y-3">
        <p className="text-sm text-slate-600">{message}</p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={sharing ? stop : start}
            disabled={blocked || status === "no-bus"}
            className={cn(
              "btn-primary text-sm",
              sharing ? "bg-emerald-600 hover:bg-emerald-700" : "",
            )}
          >
            {sharing ? "Stop sharing" : "Share my location"}
          </button>

          {sharing ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-slate-500"
              aria-live="polite"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              sending every 3 seconds
            </span>
          ) : null}
        </div>

        {fix ? (
          <p className="text-xs tabular-nums text-slate-500">
            Last fix {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} · ±
            {Number.isFinite(fix.accuracyM) ? `${Math.round(fix.accuracyM)} m` : "unknown accuracy"}
            {fix.speedKph !== null ? ` · ${Math.round(fix.speedKph)} km/h` : ""}
          </p>
        ) : null}

        {rejected ? (
          <p className="text-xs text-amber-700" role="status">
            Skipped a reading: {REJECTION_TEXT[rejected.reason] ?? rejected.reason}. The last good
            position is still being shown.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
