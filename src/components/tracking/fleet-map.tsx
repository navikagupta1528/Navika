"use client";

/**
 * Every reporting bus on one map.
 *
 * The roster is passed in from the server and then kept current by socket, so
 * opening this page does not start a poll loop for the whole college. Buses are
 * merged by id and a position that arrives out of order is discarded, exactly
 * as in the single-bus map — a fleet map that draws buses backwards looks
 * broken in a way a single dot does not.
 */

import { useEffect, useMemo, useState } from "react";
import { RouteMap } from "@/components/map/route-map";
import type { MapVehicle } from "@/components/map/map-types";
import { listenOnSocket, useSocketConnection } from "@/lib/realtime";
import { EV, type BusLocationPayload } from "@/lib/socket-events";
import { describeFreshness, freshnessFromAge } from "@/lib/tracking";
import { Badge } from "@/components/ui/primitives";

export type FleetBus = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  heading: number | null;
  onboardCount: number;
  /** Epoch ms of the last fix, from the server. */
  at: number;
  routeName: string | null;
  tripDirection: string | null;
  startedAt: number | null;
  /**
   * Where tapping this bus should go, or null when the viewer is not allowed to
   * open that bus. The server decides: the tracking page refuses anyone not
   * enrolled on the bus, so offering the link here unconditionally would hand
   * parents a button that lands on an error page.
   */
  href?: string | null;
};

export function FleetMap({ buses, height = "30rem" }: { buses: FleetBus[]; height?: string }) {
  const [live, setLive] = useState<Record<string, BusLocationPayload>>({});
  const [now, setNow] = useState(() => Date.now());

  /**
   * The server's view is the starting point for the ordering guard, so the
   * `live` map only ever holds positions that are genuinely newer than what the
   * page was rendered with. Without this the first event for a bus already on
   * screen would be judged against zero and an out-of-order replay could drag a
   * bus backwards.
   */
  const baseline = useMemo(
    () => new Map(buses.map((bus) => [bus.id, bus.at])),
    [buses],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Subscribe once to the single shared socket rather than per bus. The
   * `bus:location` event carries its own busId, so one handler covers the whole
   * fleet and there is no unsubscribe churn when the roster changes length.
   *
   * The ordering check is inside the updater rather than in render, so it
   * always sees the previous value it is being compared against.
   */
  useEffect(
    () =>
      listenOnSocket<BusLocationPayload>(EV.busLocation, (payload) => {
        if (!payload?.busId || !payload.at) return;
        setLive((prev) => {
          const seen = prev[payload.busId]?.at ?? baseline.get(payload.busId) ?? 0;
          if (payload.at < seen) return prev;
          return { ...prev, [payload.busId]: payload };
        });
        setNow((current) => Math.max(current, payload.at));
      }),
    [baseline],
  );

  const connection = useSocketConnection();

  const vehicles: MapVehicle[] = buses.map((bus) => {
    const payload = live[bus.id];
    const lat = payload?.lat ?? bus.lat;
    const lng = payload?.lng ?? bus.lng;
    const at = Math.max(payload?.at ?? bus.at, bus.at);
    const ageMs = Math.max(0, now - at);
    const onboard = payload?.onboardCount ?? bus.onboardCount;

    return {
      id: bus.id,
      lat,
      lng,
      label: bus.label,
      freshness: freshnessFromAge(ageMs),
      heading: payload?.headingDeg ?? bus.heading,
      detail: [
        describeFreshness(ageMs).label,
        `${onboard} on board`,
        bus.routeName,
        bus.href ? null : "tap for route",
      ]
        .filter(Boolean)
        .join(" · "),
      href: bus.href ?? null,
    };
  });

  const oldest = vehicles.reduce(
    (max, v) => Math.max(max, (v.freshness ?? 0) === 0 ? 1 : 0),
    0,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <Badge tone={oldest ? "amber" : "emerald"}>
          {oldest ? "some buses out of date" : "all reporting"}
        </Badge>
      </div>
      <RouteMap
        vehicles={vehicles}
        height={height}
        emptyMessage="No buses are reporting right now."
        interactive
      />
      {connection !== "live" ? (
        <p className="text-xs text-slate-500">
          Socket {connection === "offline" ? "disconnected" : "connecting"} — positions shown
          are the last the server received.
        </p>
      ) : null}
    </div>
  );
}
