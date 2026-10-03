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
import { listenOnSocket, useSocketConnection, useStopArrivals } from "@/lib/realtime";
import { EV, type BusLocationPayload, type StopArrivalPayload } from "@/lib/socket-events";
import { describeFreshness, freshnessFromAge } from "@/lib/tracking";
import { Badge } from "@/components/ui/primitives";

/** How many stop announcements the map keeps on screen. */
const MAX_ANNOUNCEMENTS = 6;

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

export function FleetMap({
  buses,
  serverNow,
  height = "30rem",
}: {
  buses: FleetBus[];
  serverNow: number;
  height?: string;
}) {
  const [live, setLive] = useState<Record<string, BusLocationPayload>>({});

  /**
   * Start from the clock the query used, not from a fresh `Date.now()`.
   *
   * This badge is server-rendered, so whatever `now` holds during the first
   * render is what lands in the HTML — and the client's first render has to
   * produce the same bytes or React discards the tree and re-renders with a
   * hydration error in the console. Reading the clock here rather than in the
   * page guarantees a mismatch whenever a bus crosses `STALE_AFTER_MS` between
   * the server's read and the browser's, which is rare, and therefore the kind
   * of bug that gets reported as "the console complains sometimes".
   *
   * `getFleetPositions` already returns the instant it filtered against as
   * `asOf`, and documents why one clock has to serve both sides. This reuses
   * that value rather than taking a second reading a few milliseconds later,
   * which is the exact drift the comment there warns about.
   *
   * Required rather than optional: a default would reintroduce the second
   * clock silently at every call site that forgot it.
   */
  const [now, setNow] = useState(serverNow);
  const [announcements, setAnnouncements] = useState<StopArrivalPayload[]>([]);

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
    // No immediate sync: `serverNow` is a correct reading, just an old one, and
    // the first tick lands within a second. Setting state in the effect body
    // instead would render twice on mount and trip `set-state-in-effect`.
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

  /*
   * Stop announcements, newest first.
   *
   * Bounded at MAX_ANNOUNCEMENTS and trimmed on arrival rather than by a timer,
   * because this list only ever grows when something happens. A fleet map left
   * open over a morning of service would otherwise accumulate an arrival for
   * every stop on every route - hundreds of rows nobody will ever scroll to, and
   * a memory leak that only shows up in a long-running browser tab.
   */
  useStopArrivals((payload) => {
    if (!payload?.busId || !payload.at) return;
    setAnnouncements((prev) => [
      payload,
      ...prev.filter((a) => !(a.busId === payload.busId && a.stopId === payload.stopId)),
    ].slice(0, MAX_ANNOUNCEMENTS));
  });

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

      {/*
        Stop announcements. Rendered below the map rather than over it, because a
        toast on top of the map covers the very bus it is describing.

        `aria-live="polite"` so a screen reader announces an arrival without
        interrupting whatever the user is doing. A simulated bus is labelled as
        such: an arrival from a demo run must never read as a real vehicle reaching
        a real gate.
      */}
      {announcements.length > 0 ? (
        <div aria-live="polite" className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Latest arrivals</p>
          <ul className="mt-1 space-y-0.5">
            {announcements.map((a) => {
              const label = buses.find((b) => b.id === a.busId)?.label ?? a.busId;
              return (
                <li key={`${a.busId}-${a.stopId}-${a.at}`} className="text-xs text-slate-600">
                  <span className="font-medium text-slate-900">{label}</span> reached {a.stopName}
                  {a.simulated ? (
                    <span className="ml-1 text-slate-500">(simulated)</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
