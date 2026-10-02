import type { LatLng } from "@/lib/geo";

/**
 * Props for the shared map, and the shapes the callers pass in.
 *
 * These live apart from the component so that a Server Component can build the
 * payload and a Client Component can consume it without either importing the
 * other. `RouteMap` itself is the Client Component; the MapLibre canvas behind
 * it is loaded with `ssr: false` because WebGL does not exist on the server.
 */

export type MapStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** 1-based position along the route. Rendered as the badge on the marker. */
  order?: number | null;
  /** Deactivated stops are drawn muted and are not clickable. */
  isActive?: boolean;
  /** Small line under the name in the popup, e.g. a scheduled time. */
  detail?: string | null;
};

export type MapVehicle = {
  id: string;
  lat: number;
  lng: number;
  /** Bus number or plate, shown in the popup. */
  label: string;
  /**
   * 0 = never reported, 1 = just reported. Drives the freshness ring colour,
   * which is the main thing a worried parent is looking for.
   */
  freshness?: number;
  /** Degrees clockwise from north. */
  heading?: number | null;
  detail?: string | null;
  /**
   * An in-app path to offer as a link in the popup, e.g. `/track/<busId>`.
   *
   * The map does not trust this: `map-canvas.tsx` renders it only if it is a
   * local path, so a value arriving over a socket cannot become a link offsite.
   * Null means "no link" — the right answer for a viewer who is not allowed to
   * open that bus's tracking page.
   */
  href?: string | null;
};

/** Marker appearance, so callers do not have to know about CSS class names. */
export type MarkerTone = "brand" | "muted" | "vehicle";

export type RouteMapProps = {
  stops?: MapStop[];
  /**
   * Road-following path, in visiting order. Falls back to straight lines
   * between the stops when absent, which is honest about being an estimate
   * rather than pretending to be a road.
   */
  geometry?: LatLng[];
  vehicles?: MapVehicle[];
  /** CSS length. The map needs a sized container or it renders at zero height. */
  height?: string;
  className?: string;
  /** Used when there is nothing to fit into the viewport. */
  fallbackViewport?: { center: LatLng; zoom: number };
  /** Non-interactive maps are cheaper and are the right choice for thumbnails. */
  interactive?: boolean;
  onStopClick?: (stopId: string) => void;
  /**
   * Enables drag-to-reorder and reports the new order.
   *
   * The marker is snapped back to its true position on every render, so
   * returning without changing `stops` is how the component says "no, put that
   * back" — which is exactly what should happen when the server rejects a
   * reorder.
   */
  onReorder?: (orderedIds: string[]) => void | Promise<void>;
  /** Shown when there is nothing at all to draw. */
  emptyMessage?: string;
};

/** Pune, where the seed data lives. A sane default view for this system. */
export const DEFAULT_VIEWPORT = {
  center: { lat: 18.5204, lng: 73.8567 },
  zoom: 12,
};
