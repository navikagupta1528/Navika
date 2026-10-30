"use client";

/**
 * "Your bus is N minutes away", counted down live.
 *
 * WHY THIS EXISTS
 *
 * The parent and track screens already showed an ETA — but it was computed once
 * on the server and passed as a prop, so it never moved. A parent who opened the
 * page three minutes before the bus arrived saw the same number the whole time,
 * while the socket delivering the bus's position every few seconds only moved the
 * dot on the map. The one number a parent actually acts on was frozen.
 *
 * The arithmetic lives in `@/lib/arrival`, shared with the map popup and unit
 * tested. This component is the React shell around it: subscribe, tick, render.
 */

import { useEffect, useState } from "react";
import { useBusLocation } from "@/lib/realtime";
import type { BusLocationPayload } from "@/lib/socket-events";
import { ARRIVING_METERS } from "@/lib/geofence";
import {
  approachFraction,
  formatCountdown,
  readArrival,
  type ArrivalFix,
  type ArrivalReading,
  type ArrivalStop,
  type CountdownTone,
} from "@/lib/arrival";

export type ArrivalCountdownProps = {
  busId: string;
  /** The viewer's own stop. Null for an admin, who watches the whole route. */
  stop: ArrivalStop;
  /** The server's ETA at first paint, so the first frame is not a spinner. */
  initialEtaMinutes: number | null;
  /**
   * The instant the page decided freshness against. Required and not defaulted,
   * for the same reason `LiveTrackingMap`'s is: the server renders a countdown
   * from this value, and a second clock read on the client would disagree by a
   * second and mismatch hydration.
   */
  serverNow: number;
  initialPosition: ArrivalFix | null;
  /**
   * "full" is the hero card on the tracking page. "compact" is a bare number for
   * a `StatTile`, where the tile already owns the size, colour and caption — a
   * bar and a second sentence inside a 2xl tile would be a card inside a card.
   */
  variant?: "full" | "compact";
};

export function ArrivalCountdown({
  busId,
  stop,
  initialEtaMinutes,
  serverNow,
  initialPosition,
  variant = "full",
}: ArrivalCountdownProps) {
  const [fix, setFix] = useState<ArrivalFix | null>(initialPosition);

  // Ticks so the countdown moves between pings, and so a bus that stops
  // reporting is caught by the freshness gate rather than counted down forever.
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const onLocation = (payload: BusLocationPayload) => {
    if (!payload?.at) return;
    setFix((current) =>
      current && payload.at < current.at
        ? current
        : { lat: payload.lat, lng: payload.lng, at: payload.at },
    );
    // Trust the server's clock, not the browser's, and let the freshness gate
    // catch up immediately rather than on the next one-second tick.
    setNow((current) => Math.max(current, payload.at));
  };

  useBusLocation(busId, onLocation);

  const reading = readArrival({ fix, stop, now, initialEtaMinutes });

  if (variant === "compact") {
    return <CompactCountdown reading={reading} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <CountdownFace reading={reading} stopName={stop?.name ?? null} />
      <ProgressBar reading={reading} />
    </div>
  );
}

/** Just the number, for a `StatTile` that already sizes and colours it. */
function CompactCountdown({ reading }: { reading: ArrivalReading }) {
  if (reading.kind === "none") {
    return <span className="tabular-nums text-slate-400">—</span>;
  }
  if (reading.kind === "stale") {
    return <span className="text-amber-600">paused</span>;
  }

  const { value, unit } = formatCountdown(reading.seconds);
  return (
    <span className="tabular-nums">
      {value}
      {unit ? <span className="ml-1 text-sm font-normal text-slate-500">{unit}</span> : null}
    </span>
  );
}

function CountdownFace({
  reading,
  stopName,
}: {
  reading: ArrivalReading;
  stopName: string | null;
}) {
  if (reading.kind === "none") {
    return (
      <div>
        <p className="text-3xl font-semibold tabular-nums text-slate-400">—</p>
        <p className="text-sm text-slate-500">Waiting for the bus to start reporting.</p>
      </div>
    );
  }

  if (reading.kind === "stale") {
    return (
      <div>
        <p className="text-3xl font-semibold tabular-nums text-amber-600">paused</p>
        <p className="text-sm text-slate-500">
          The bus stopped reporting, so this countdown is held rather than guessed.
        </p>
      </div>
    );
  }

  const { value, unit, tone } = formatCountdown(reading.seconds);

  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className={`text-4xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
          {value}
        </span>
        {unit ? <span className="text-base text-slate-500">{unit}</span> : null}
      </p>
      <p className="mt-0.5 text-sm text-slate-600" aria-live="polite" role="status">
        {reading.seconds <= 10
          ? "Arriving now — head to the stop."
          : stopName
            ? `Away from ${stopName}.`
            : "Away."}
      </p>
    </div>
  );
}

/**
 * How close the bus is, as a bar rather than a number.
 *
 * Transform-only, and that is not decoration: an animated `width` would re-run
 * layout on every second of every open tracking page, which is the main-thread
 * cost the rest of this project goes out of its way to avoid. A `scaleX` is
 * handled by the compositor and costs nothing per frame.
 */
function ProgressBar({ reading }: { reading: ArrivalReading }) {
  const distance = reading.kind === "none" ? null : reading.distanceMeters;
  const fraction = approachFraction(distance);
  const atStop = distance !== null && distance <= ARRIVING_METERS;

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      role="presentation"
    >
      <div
        className={`h-full origin-left rounded-full ${atStop ? "bg-emerald-500" : "bg-brand-600"}`}
        style={{ transform: `scaleX(${fraction})`, transition: "transform 900ms linear" }}
      />
    </div>
  );
}

const TONE_TEXT: Record<CountdownTone, string> = {
  far: "text-slate-900",
  near: "text-brand-700",
  here: "text-emerald-600",
};
