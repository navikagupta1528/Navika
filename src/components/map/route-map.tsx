"use client";

import dynamic from "next/dynamic";

import type { RouteMapProps } from "./map-types";

/**
 * The map, as a Server Component sees it.
 *
 * `MapCanvas` is behind `ssr: false` because maplibre-gl touches `window` at
 * module scope, so it cannot be evaluated on the server at all — not even
 * behind a conditional. And `ssr: false` is only legal inside a Client
 * Component, which is what this file is. That is why there are two files: this
 * lazy-loading wrapper, and the canvas it defers to.
 *
 * Every prop is passed through as a plain serialisable object, so a Server
 * Component can build the payload and hand it straight over.
 */
const MapCanvas = dynamic(() => import("./map-canvas"), {
  ssr: false,
  loading: () => (
    <div
      className="animate-pulse rounded-xl bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100"
      style={{ height: "20rem" }}
      aria-hidden
    />
  ),
});

export function RouteMap(props: RouteMapProps) {
  // The dynamic import's own placeholder cannot know the caller's height, so
  // render the canvas immediately and let it draw its own skeleton. That keeps
  // the reserved space identical to the loaded map, which stops the page from
  // jumping when the map arrives.
  return <MapCanvas {...props} />;
}

export type { MapStop, MapVehicle, RouteMapProps } from "./map-types";
