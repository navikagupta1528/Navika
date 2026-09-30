"use client";

import { useState } from "react";

import { reorderRouteStops } from "@/app/actions/admin/routes";
import { RouteMap } from "@/components/map/route-map";
import { formatDistance, type LatLng } from "@/lib/geo";
import type { MapStop } from "@/components/map/map-types";

/**
 * The route map with drag-to-reorder.
 *
 * React owns the order while a drag is in flight, because a marker that jumps
 * back the instant you let go feels broken. The server is still the authority:
 * the optimistic order is reverted if the write fails, and `revalidatePath` in
 * the action re-renders this page with what was actually stored.
 */

export type RouteStopForMap = {
  /** `RouteStop.id`, not the stop's id — the map reorders the join rows. */
  routeStopId: string;
  stopId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  stopOrder: number;
  scheduledHHMM: string | null;
  isActive: boolean;
  enrolled: number;
};

type Props = {
  routeId: string;
  routeCode: string;
  stops: RouteStopForMap[];
  /** Road-following path, or absent when the route could not be geocoded. */
  geometry?: LatLng[];
  roadDistanceMeters?: number | null;
  /** True when the line is a straight-line estimate rather than real roads. */
  geometryIsEstimated?: boolean;
};

export function RouteMapEditor({
  routeId,
  routeCode,
  stops,
  geometry,
  roadDistanceMeters,
  geometryIsEstimated = false,
}: Props) {
  const [order, setOrder] = useState(() =>
    stops.slice().sort((a, b) => a.stopOrder - b.stopOrder),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Stops in the order currently shown, which is what the map draws. */
  const ordered = order.slice().sort((a, b) => a.stopOrder - b.stopOrder);

  const mapStops: MapStop[] = ordered.map((stop, index) => ({
    id: stop.routeStopId,
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    order: index + 1,
    isActive: stop.isActive,
    detail: [
      stop.scheduledHHMM ? `due ${stop.scheduledHHMM.slice(0, 5)}` : null,
      stop.enrolled > 0 ? `${stop.enrolled} student${stop.enrolled === 1 ? "" : "s"}` : null,
      stop.isActive ? null : "deactivated",
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  async function handleReorder(orderedIds: string[]) {
    // A second drag while the first write is in flight would resolve out of
    // order and leave the map showing something the database does not hold.
    if (saving) return;

    setError(null);

    // Remember exactly what we had, so a rejected write restores the true order
    // rather than an approximation of it.
    const previous = order;
    const rank = new Map(orderedIds.map((id, index) => [id, index + 1]));
    const optimistic = previous
      .map((stop) => ({ ...stop, stopOrder: rank.get(stop.routeStopId) ?? stop.stopOrder }))
      .sort((a, b) => a.stopOrder - b.stopOrder);
    setOrder(optimistic);

    const formData = new FormData();
    formData.set("routeId", routeId);
    formData.set("ids", orderedIds.join(","));

    setSaving(true);
    try {
      const result = await reorderRouteStops(formData);
      if (!result.ok) {
        setOrder(previous);
        setError(result.error);
      }
    } catch {
      // A network drop, or a session that expired mid-drag.
      setOrder(previous);
      setError("The reorder could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = order.length < 2 || saving;

  return (
    <div className="space-y-3">
      <RouteMap
        height="24rem"
        stops={mapStops}
        geometry={geometry}
        onReorder={disabled ? undefined : handleReorder}
        emptyMessage="Add at least two stops to see the route."
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-slate-500">
          {saving
            ? "Saving the new order…"
            : `${routeCode} · drag a marker along the route to change its position in the sequence.`}
        </p>
        {roadDistanceMeters != null ? (
          <p className="font-medium tabular-nums text-slate-700">
            {formatDistance(roadDistanceMeters)}
            {geometryIsEstimated ? " (estimated)" : " by road"}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="alert-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
