"use client";

/**
 * A live map of one bus, for students, parents and admins.
 *
 * The route and the last known position arrive as props from the server, and
 * everything after that is socket-driven. The component never polls: it holds
 * the last position it was told about and re-renders when a newer one lands,
 * which is what keeps a 40-bus fleet from generating 40 requests per second
 * from parents' phones.
 *
 * Freshness is the part that matters most. A bus whose driver's phone went into
 * a basement keeps showing its last position, and that dot slowly turning amber
 * is the only honest way to say "we do not know where this is right now".
 */

import { useCallback, useEffect, useState } from "react";
import { RouteMap } from "@/components/map/route-map";
import type { MapStop, MapVehicle } from "@/components/map/map-types";
import type { LatLng } from "@/lib/geo";
import { useBusLocation, useSocketConnection } from "@/lib/realtime";
import type { BusLocationPayload } from "@/lib/socket-events";
import { Badge, Card, CardTitle } from "@/components/ui/primitives";
import { describeFreshness, freshnessFromAge } from "@/lib/tracking";
import { etaLabel } from "@/lib/utils";

export type LiveTrackingMapProps = {
  busId: string;
  busLabel: string;
  stops: MapStop[];
  geometry?: LatLng[];
  /** Last position the server had on file, so the map is never blank. */
  initialPosition?: { lat: number; lng: number; at: string | number } | null;
  /** Where this particular viewer is watching from, if anywhere. */
  watchLabel?: string | null;
  /** Minutes to the viewer's own stop, refreshed by the page, not the socket. */
  etaMinutes?: number | null;
  height?: string;
};

export function LiveTrackingMap({
  busId,
  busLabel,
  stops,
  geometry,
  initialPosition,
  watchLabel = null,
  etaMinutes = null,
  height = "24rem",
}: LiveTrackingMapProps) {
  const [position, setPosition] = useState<BusLocationPayload | null>(() => {
    if (!initialPosition) return null;
    return {
      busId,
      lat: initialPosition.lat,
      lng: initialPosition.lng,
      speedKph: null,
      headingDeg: null,
      onboardCount: 0,
      at:
        typeof initialPosition.at === "number"
          ? initialPosition.at
          : Date.parse(initialPosition.at),
    };
  });

  /**
   * Re-read every second purely so the freshness ring decays. The socket only
   * speaks when the bus moves, so without a tick the "live" badge would stay
   * live forever on a tab left open after the driver closed the app — which is
   * precisely the lie this component exists to avoid.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Out-of-order delivery guard.
   *
   * The comparison lives in the *callback*, not in render, and that placement is
   * the whole point. Socket.IO preserves order within one connection, but the
   * server replays a bus's last known position when a client subscribes, so the
   * first event on a fresh tab can be older than the position the server already
   * rendered into the initial state. Keeping the newest `at` in state — updated
   * only by this callback — means a late arrival is dropped at the door.
   *
   * Doing it with a ref read during render, as an earlier version did, is subtly
   * broken: the ref is written in an effect that runs *after* the render that
   * reads it, so the guard compares the new position against the value from
   * before the last update, and a genuinely older packet gets through.
   */
  const onLocation = useCallback(
    (payload: BusLocationPayload) => {
      if (!payload?.at) return;

      setPosition((current) => {
        if (current && payload.at < current.at) return current;
        return payload;
      });

      // Trust the server's clock, not the browser's, and let the freshness ring
      // catch up immediately instead of on the next one-second tick.
      setNow((current) => Math.max(current, payload.at));
    },
    [],
  );

  useBusLocation(busId, onLocation);
  const connection = useSocketConnection();

  const ageMs = position ? Math.max(0, now - position.at) : null;
  const freshness = position ? freshnessFromAge(ageMs ?? 0) : 0;
  const shown = position;

  const vehicles: MapVehicle[] = shown
    ? [
        {
          id: busId,
          lat: shown.lat,
          lng: shown.lng,
          label: busLabel,
          freshness,
          heading: shown.headingDeg,
          detail: `${describeFreshness(ageMs ?? 0).label} · ${etaLabel(etaMinutes)} to ${watchLabel ?? "your stop"}`,
        },
      ]
    : [];

  const live = describeFreshness(ageMs ?? Number.POSITIVE_INFINITY);

  return (
    <Card>
      <CardTitle
        hint={watchLabel ? `Following ${busLabel} towards ${watchLabel}` : `Following ${busLabel}`}
        action={
          <span className="flex items-center gap-2">
            <Badge tone={shown ? live.tone : "slate"}>
              {shown ? live.label : "not moving"}
            </Badge>
            {connection !== "live" ? (
              <Badge tone={connection === "offline" ? "red" : "amber"}>
                {connection === "offline" ? "disconnected" : "connecting"}
              </Badge>
            ) : null}
          </span>
        }
      >
        Live position
      </CardTitle>

      <RouteMap
        stops={stops}
        geometry={geometry}
        vehicles={vehicles}
        height={height}
        emptyMessage="No stops on this route yet."
      />

      <p className="mt-2 text-xs text-slate-500" aria-live="polite">
        {shown
          ? live.detail
          : connection === "offline"
            ? "Disconnected, so this is the last position we received."
            : "Waiting for the driver to start sharing a location."}
      </p>
    </Card>
  );
}
