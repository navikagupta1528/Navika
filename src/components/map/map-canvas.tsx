"use client";

import {
  Map as MapLibreMap,
  Marker,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  haversineMeters,
  isValidPoint,
  moveItem,
  nearestOnPolyline,
  slotFromT,
  toLngLat,
  viewportFor,
  type LatLng,
} from "@/lib/geo";
import { DEFAULT_VIEWPORT, type MapStop, type RouteMapProps } from "./map-types";
import { classifyMapError, mapFailureMessage, type MapFailure } from "@/lib/map-errors";
import { mapWorkerUrl } from "@/lib/map-worker";

/**
 * The MapLibre canvas.
 *
 * Split from `RouteMap` so this file — the only one that imports maplibre-gl —
 * sits behind `ssr: false`. MapLibre touches `window` while the module is being
 * evaluated, not just when a map is constructed, so it cannot be imported on
 * the server at all.
 *
 * Everything here is imperative because MapLibre's model is: a mutable map and
 * mutable marker objects that live outside React's tree. The discipline that
 * keeps it manageable is that React owns the *data* and this file owns only the
 * *presentation*. When the props change, the markers are rebuilt from them.
 * Nothing accumulates, and no marker holds state React does not know about.
 */

const SOURCE_ID = "navika-route";
const LINE_LAYER_ID = "navika-route-line";
const LINE_CASING_LAYER_ID = "navika-route-line-casing";

/*
 * Point MapLibre at a worker that actually loads.
 *
 * The short version, because the long version is in `src/lib/map-worker.ts`:
 * MapLibre finds its worker as a sibling of its own module URL, which no
 * bundler preserves, and pointing it at the hashed asset the bundler emitted
 * only fixes half the problem - that asset's own `import "./maplibre-gl-shared.mjs"`
 * still 404s, because the shared chunk was hashed under a different name.
 *
 * `/api/map-worker` serves the pair from the installed package as one directory,
 * so the relative import resolves exactly as MapLibre expects.
 *
 * `process.env.NODE_ENV` rather than a constant, to pick the unminified worker
 * in development the way MapLibre does for itself.
 *
 * Safe at module scope: `RouteMap` reaches this file through
 * `next/dynamic({ ssr: false })` and nothing else imports it, so this never
 * runs on the server.
 *
 * Without a worker, MapLibre draws no tiles at all - an empty canvas rather than
 * an error on screen, which is the worst possible failure for the main screen of
 * a tracking product. The console message it does print says the worker URL is
 * wrong, which is a statement about this line and not about the URL.
 */
setWorkerUrl(mapWorkerUrl(process.env.NODE_ENV !== "production"));

/**
 * OpenStreetMap raster tiles, as an inline style.
 *
 * Inline rather than fetching somebody's hosted style document, so there is no
 * runtime dependency on a URL that can change shape without warning and break
 * the route line layer silently.
 *
 * OSM's public tile server is explicitly meant to serve projects at this scale.
 * It is not a production dependency: point `NEXT_PUBLIC_MAP_TILE_URL` at a
 * hosted provider before deploying for real.
 */
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function buildStyle(tileUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#e8edf2" } },
      { id: "basemap", type: "raster", source: "basemap" },
    ],
  };
}

/**
 * Whether this browser can give us a WebGL context at all.
 *
 * Checked before the map is built rather than caught afterwards, because "no
 * WebGL" is an ordinary condition — an old driver, a blocklisted software
 * rasteriser, a locked-down enterprise browser — and not an exception. It is by
 * far the most likely reason a map fails to appear, so it gets a real answer up
 * front and a real explanation on screen.
 */
type WebGLSupport = "unknown" | "available" | "unavailable";

function probeWebGL(): WebGLSupport {
  if (typeof document === "undefined") return "unknown";

  let context: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  } catch {
    return "unavailable";
  }
  if (!context) return "unavailable";

  // Browsers cap how many WebGL contexts can be alive at once (commonly 16)
  // and silently drop the oldest. Probing on every mount and holding the result
  // would eventually starve the real map, so hand this one straight back.
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return "available";
}

export default function MapCanvas({
  stops = [],
  geometry,
  vehicles = [],
  height = "20rem",
  className,
  fallbackViewport = DEFAULT_VIEWPORT,
  interactive = true,
  onStopClick,
  onReorder,
  emptyMessage,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const stopMarkers = useRef(new Map<string, Marker>());
  const vehicleMarkers = useRef(new Map<string, Marker>());

  // MapLibre needs a container with no children and a non-zero size, neither of
  // which is knowable during server rendering.
  //
  // `support` is probed once, in the lazy initialiser, so the decision is made
  // during the first render rather than by reporting a failure from inside an
  // effect. The probe is idempotent, so a double render in StrictMode costs
  // nothing.
  const [support] = useState<WebGLSupport>(probeWebGL);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<MapFailure>("none");

  /**
   * Report a failure after this commit finishes, never during it.
   *
   * These are raised from inside MapLibre callbacks, which can fire while React
   * is rendering - a tile error during the commit that mounted the map would be
   * a set-state-during-render, which React treats as a bug in this code rather
   * than as a network event.
   */
  const reportFailure = useCallback((what: MapFailure) => {
    queueMicrotask(() => setFailure(what));
  }, []);

  /**
   * Whether the underlying failure has already been logged.
   *
   * A public tile server 404s individual tiles routinely, so the error listener
   * below sees a steady trickle of them. Logging each one would bury the first -
   * the one that says why the map is empty - under a hundred that just say a
   * tile was missing. Once is enough: after that the screen is already telling
   * the user, and a repeat log line adds no new information.
   */
  const loggedFailureRef = useRef(false);

  /**
   * The stop currently being dragged.
   *
   * Markers must not be repositioned from inside their own drag handlers, or a
   * drag in progress snaps back to where it started. Held in a ref rather than
   * state because changing it must not trigger a render.
   */
  const draggingRef = useRef<string | null>(null);

  // Callbacks are read through refs so that passing an inline arrow function
  // does not tear down and rebuild every marker on each parent render.
  const stopClickRef = useRef(onStopClick);
  const reorderRef = useRef(onReorder);
  useEffect(() => {
    stopClickRef.current = onStopClick;
    reorderRef.current = onReorder;
  });

  /** Points worth showing, with invalid coordinates already discarded. */
  const usableStops = useMemo(() => stops.filter(isValidPoint), [stops]);
  const usableVehicles = useMemo(() => vehicles.filter(isValidPoint), [vehicles]);

  /** Stops in visiting order, which is what the route line and slots use. */
  const orderedStops = useMemo(
    () => usableStops.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [usableStops],
  );

  /**
   * The path actually drawn.
   *
   * Prefers real road geometry, falls back to straight segments between stops.
   * Fewer than two points means no line to draw, not a degenerate one.
   */
  const line = useMemo<LatLng[]>(() => {
    const road = (geometry ?? []).filter(isValidPoint);
    if (road.length >= 2) return road;
    const straight = orderedStops.map((s) => ({ lat: s.lat, lng: s.lng }));
    return straight.length >= 2 ? straight : [];
  }, [geometry, orderedStops]);

  /**
   * The latest route data, for the marker handlers to read.
   *
   * Markers are keyed by id and live for as long as the map does, so their
   * listeners are attached exactly once — on the render that created them. A
   * listener that closed over that render's `stop` would keep answering with
   * the name, detail and position the stop had when the map first drew, and
   * `dragend` would reorder against a stale array. Reordering and renaming are
   * ordinary admin actions, so "stale once the data changes" is the normal
   * case here, not an edge case.
   *
   * The callbacks above already needed this treatment for a different reason
   * (an inline arrow would remount every marker); these needed it because the
   * values change. Both end up read at event time, never captured.
   *
   * Declared before the marker effects, so the sync below always runs first.
   */
  const stopsRef = useRef(orderedStops);
  const vehiclesRef = useRef(usableVehicles);
  const lineRef = useRef(line);
  useEffect(() => {
    stopsRef.current = orderedStops;
    vehiclesRef.current = usableVehicles;
    lineRef.current = line;
  });

  // --- Map creation -------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (support !== "available" || !container || mapRef.current) return;

    // Captured so the cleanup below does not read a ref that may since have
    // been swapped for a different Map.
    const stopMarkerMap = stopMarkers.current;
    const vehicleMarkerMap = vehicleMarkers.current;

    const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? DEFAULT_TILE_URL;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: buildStyle(tileUrl, OSM_ATTRIBUTION),
        center: toLngLat(fallbackViewport.center),
        zoom: fallbackViewport.zoom,
        interactive,
        // Rotation and pitch are noise for a bus route, and left enabled they
        // make drag-to-reorder feel broken: dragging a marker can also rotate
        // the map out from under it.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maplibreLogo: false,
        // The built-in AttributionControl is replaced by `MapAttribution` below.
        // It renders its links with no underline and no other non-colour cue, so
        // every map in the app failed `link-in-text-block`: a link sitting in a
        // run of text that is distinguishable only by being a slightly different
        // colour. That is a real WCAG 1.4.1 failure, and it is MapLibre's markup
        // rather than ours, which is why it cannot be fixed with a class.
        //
        // Turning the control off also means the attribution is ours to lay out,
        // so it can sit in the corner the app already reserves and stay legible
        // over a dark route line instead of fighting the control for the same
        // pixels.
        attributionControl: false,
        maxZoom: 19,
      });
    } catch {
      // The probe said WebGL exists, so this is the unexpected case: a
      // driver that advertises support and then fails to initialise, or an
      // out-of-memory context. Report it rather than leaving a dead grey box.
      reportFailure("worker");
      return;
    }

    map.on("error", (event) => {
      /*
       * Classify before deciding anything, and keep the original text.
       *
       * This used to test one regex - `/style|json|not found|failed to load/i` -
       * against every error and show "the map tiles or style could not be
       * loaded" when it matched. That regex also matches MapLibre's own worker
       * failure, so an engine that would not start was reported to the user as a
       * fault in somebody else's tile server, with the same confidence as if the
       * two were the same thing. They are not: one is this page's code, the other
       * is a third-party host, and they are fixed in different places.
       *
       * The fix is to know which half broke, and to keep the real text so that
       * a report from a user carries evidence instead of a guess. It is logged
       * once, because tile 404s are routine and a hundred of them would bury
       * the first. In development Next forwards browser console output to the
       * server log, so this is also how a failure gets diagnosed at all from
       * someone else's machine.
       */
      const message = event.error?.message;
      const what = classifyMapError(message);
      if (what === "none") return;

      if (!loggedFailureRef.current) {
        loggedFailureRef.current = true;
        console.error(`[map] ${what} failure:`, message ?? event.error);
      }
      reportFailure(what);
    });

    // One popup for the whole map. A popup per marker would mean a dozen hidden
    // popups and a dozen ways to leave one stranded on screen.
    popupRef.current = new Popup({ closeButton: true, closeOnClick: true, offset: 14 });

    /**
     * `style.load`, not `load`.
     *
     * `load` waits for the first tiles, which on a cold cache over a slow
     * connection is seconds of grey square — exactly when the skeleton is most
     * wanted. `style.load` fires as soon as the style document is parsed and
     * the layers exist, which is the moment the canvas is real and the map is
     * about to draw into it.
     */
    map.on("style.load", () => setReady(true));

    mapRef.current = map;

    return () => {
      mapRef.current = null;
      popupRef.current = null;
      stopMarkerMap.clear();
      vehicleMarkerMap.clear();
      map.remove();
    };
    // Built once. Later effects apply every input, because rebuilding the map
    // to change its data throws away the user's pan, zoom and any drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [support, reportFailure]);

  // --- Initial framing ----------------------------------------------------

  const framedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || framedRef.current) return;

    const points = [...usableStops, ...usableVehicles].map((p) => ({ lat: p.lat, lng: p.lng }));
    const viewport = viewportFor(points, fallbackViewport);
    map.jumpTo({ center: toLngLat(viewport.center), zoom: viewport.zoom });
    framedRef.current = true;
  }, [ready, usableStops, usableVehicles, fallbackViewport]);

  // --- Route line ---------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: line.length
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: line.map(toLngLat) },
            },
          ]
        : [],
    };

    const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }

    map.addSource(SOURCE_ID, { type: "geojson", data });
    // A wide casing under a narrower line reads as a road outline rather than a
    // scribble, and is what makes two routes sharing a road distinguishable.
    map.addLayer({
      id: LINE_CASING_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 12],
      },
    });
    map.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#1d4ed8",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 6],
        "line-opacity": 0.85,
      },
    });
  }, [line, ready]);

  // --- Stop markers, including drag-to-reorder ----------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const wanted = new Set(orderedStops.map((s) => s.id));
    for (const [id, marker] of stopMarkers.current) {
      if (!wanted.has(id)) {
        marker.remove();
        stopMarkers.current.delete(id);
      }
    }

    for (const [index, stop] of orderedStops.entries()) {
      const order = stop.order ?? index + 1;
      const muted = stop.isActive === false;
      const interactive_ = Boolean(stopClickRef.current) && !muted;

      const element = document.createElement("button");
      element.type = "button";
      element.className = `navika-marker navika-marker--stop${muted ? " navika-marker--muted" : ""}`;
      element.setAttribute("aria-label", `Stop ${order}: ${stop.name}`);
      // Safe by construction: `order` is a number and the badge holds no user
      // text. Anything user-supplied goes through `textContent` or escaping.
      element.textContent = String(order);
      element.disabled = !interactive_;

      const existing = stopMarkers.current.get(stop.id);
      if (existing) {
        if (draggingRef.current !== stop.id) {
          existing.setLngLat(toLngLat({ lat: stop.lat, lng: stop.lng }));
        }
        // `getElement()` is typed as HTMLElement, but every marker in this file is
        // built from a `document.createElement("button")` a few lines above and
        // never replaced, so the cast narrows to what is already true.
        const current = existing.getElement() as HTMLButtonElement;
        current.className = element.className;
        current.setAttribute("aria-label", element.getAttribute("aria-label") ?? "");
        // The badge number and the disabled state are part of what this marker
        // *shows*, so they have to be refreshed like className is. Skipping them
        // left the map claiming one thing and announcing another: after a
        // reorder the aria-label read out "Stop 3: Gate" while the marker still
        // displayed 1, and a stop deactivated in the admin screen went grey but
        // stayed clickable and draggable.
        current.textContent = element.textContent;
        current.disabled = element.disabled;
        continue;
      }

      /**
       * `setLngLat` before `addTo`, not after.
       *
       * A Marker constructed without a `lngLat` keeps `_lngLat` as
       * `undefined` - `LngLat.convert(undefined)` returns the input unchanged
       * rather than throwing - and `addTo()` then reads `.lng` off it and the
       * whole effect dies with "Cannot read properties of undefined". Setting
       * the position first is not a style preference; it is the only order in
       * which this call is valid.
       *
       * The existing-marker branch above already did this correctly, which is
       * why the bug only ever appeared on the first render, when every marker
       * is new.
       */
      const marker = new Marker({ element, anchor: "center" })
        .setLngLat(toLngLat({ lat: stop.lat, lng: stop.lng }))
        .addTo(map);
      stopMarkers.current.set(stop.id, marker);

      element.addEventListener("click", (event) => {
        event.stopPropagation();
        // Read the stop as it is now, not as it was when this marker was
        // created. The id is the marker key and never changes, so capturing it
        // is safe; the name, detail and position are not.
        const live = stopsRef.current.find((s) => s.id === stop.id);
        if (!live) return;
        popupRef.current
          ?.setLngLat(toLngLat({ lat: live.lat, lng: live.lng }))
          .setHTML(
            `<strong>${escapeHtml(live.name)}</strong>` +
              (live.detail ? `<br><span>${escapeHtml(live.detail)}</span>` : ""),
          )
          .addTo(map);
        stopClickRef.current?.(live.id);
      });

      if (!reorderRef.current) continue;

      marker.setDraggable(true);

      marker.on("dragstart", () => {
        draggingRef.current = stop.id;
        element.classList.add("navika-marker--dragging");
      });

      marker.on("dragend", () => {
        draggingRef.current = null;
        element.classList.remove("navika-marker--dragging");

        // Same reason as the click handler: this listener was attached when the
        // marker was created and must not answer from that render's route.
        const stops = stopsRef.current;
        const from = stops.findIndex((s) => s.id === stop.id);
        if (from < 0) return;

        const position = marker.getLngLat();

        /**
         * The drop slot comes from projecting the marker onto the route, not
         * from its pixel position. In a tight city grid two consecutive stops
         * can be a few pixels apart on screen while being far apart along the
         * path, and pixel distance gets that exactly backwards.
         */
        const line = lineRef.current;
        const path = line.length >= 2 ? line : stops.map((s) => ({ lat: s.lat, lng: s.lng }));
        const dropped = { lat: position.lat, lng: position.lng };
        const projected = nearestOnPolyline(dropped, path);
        const to = projected
          ? slotFromT(projected.t, stops.length)
          : nearestOtherStopIndex(stops, stop.id, dropped);

        // Snap home immediately. If the caller keeps the order it was given,
        // this is the visual answer; if it commits a new order, this effect
        // overwrites the snap a frame later.
        const home = stops[from];
        marker.setLngLat(toLngLat({ lat: home.lat, lng: home.lng }));

        if (to >= 0 && to !== from) {
          void reorderRef.current?.(moveItem(stops.map((s) => s.id), from, to));
        }
      });
    }
  }, [orderedStops, line, ready]);

  // --- Vehicle markers ---------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const wanted = new Set(usableVehicles.map((v) => v.id));
    for (const [id, marker] of vehicleMarkers.current) {
      if (!wanted.has(id)) {
        marker.remove();
        vehicleMarkers.current.delete(id);
      }
    }

    for (const vehicle of usableVehicles) {
      // A bus whose last ping is old is the case a parent most needs to notice,
      // so staleness is carried in the marker's appearance rather than left to
      // be read off a timestamp in a table.
      const stale = (vehicle.freshness ?? 0) < 0.25;

      const element = document.createElement("button");
      element.type = "button";
      element.className = `navika-marker navika-marker--vehicle${stale ? " navika-marker--stale" : ""}`;
      element.setAttribute("aria-label", `Bus ${vehicle.label}`);
      element.textContent = vehicle.label;

      element.addEventListener("click", (event) => {
        event.stopPropagation();
        // Live lookup, as with stops: a bus marker outlives every prop change,
        // and a socket ping is the most frequent prop change in the product.
        const live = vehiclesRef.current.find((v) => v.id === vehicle.id);
        if (!live) return;
        // `localHref` rejects anything that is not a path inside this app, so a
        // vehicle label or href arriving from a socket payload cannot turn the
        // popup into a link to somewhere else.
        const href = live.href ? localHref(live.href) : null;
        popupRef.current
          ?.setLngLat(toLngLat({ lat: live.lat, lng: live.lng }))
          .setHTML(
            `<strong>${escapeHtml(live.label)}</strong>` +
              (live.detail ? `<br><span>${escapeHtml(live.detail)}</span>` : "") +
              (href
                ? `<br><a class="navika-popup-link" href="${escapeHtml(href)}">Open details</a>`
                : ""),
          )
          .addTo(map);
      });

      const existing = vehicleMarkers.current.get(vehicle.id);
      if (existing) {
        existing.setLngLat(toLngLat({ lat: vehicle.lat, lng: vehicle.lng }));
        if (vehicle.heading != null) existing.setRotation(vehicle.heading);
        const current = existing.getElement();
        current.className = element.className;
        current.setAttribute("aria-label", element.getAttribute("aria-label") ?? "");
        // The plate number is the whole point of the marker, so it has to track
        // the data. Renaming a bus in the admin screen used to leave the old
        // plate drawn on the map while the popup for it showed the new one.
        current.textContent = element.textContent;
        continue;
      }

      /*
       * Same ordering bug as the stop markers above, and the same fix: the
       * position has to be set before the marker joins the map, or `addTo()`
       * dereferences an undefined LngLat. This one was less obvious because a
       * `setLngLat` *was* present on the next line - just too late, after the
       * call that already threw.
       */
      const marker = new Marker({ element, anchor: "center" })
        .setLngLat(toLngLat({ lat: vehicle.lat, lng: vehicle.lng }))
        .addTo(map);
      vehicleMarkers.current.set(vehicle.id, marker);
      if (vehicle.heading != null) marker.setRotation(vehicle.heading);
    }
  }, [usableVehicles, ready]);

  const hasContent = usableStops.length > 0 || usableVehicles.length > 0;
  const unavailable = support === "unavailable" || failure !== "none";

  /**
   * Which half of the map broke, in the user's terms.
   *
   * WebGL is checked first because it is a *probe*, not a failure: it has already
   * happened by the time this renders, and it is the one case where the answer
   * is about the user's hardware rather than about anything this page did.
   */
  const unavailableReason =
    support === "unavailable"
      ? "This browser could not start WebGL. The tables on this page carry the same information."
      : mapFailureMessage(failure);

  return (
    <div className={`relative overflow-hidden rounded-xl bg-slate-100 ${className ?? ""}`}>
      <div ref={containerRef} style={{ height }} className="w-full" />

      {!ready && !unavailable ? <MapSkeleton height={height} /> : null}

      {unavailable ? (
        <div
          style={{ height }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100 px-4 text-center"
        >
          <p className="text-sm font-medium text-slate-700">Map unavailable</p>
          <p className="max-w-xs text-xs text-slate-500">{unavailableReason}</p>
        </div>
      ) : null}

      {ready && !hasContent ? (
        <div
          style={{ height }}
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center"
        >
          <p className="rounded-lg bg-white/90 px-3 py-2 text-xs text-slate-600 shadow-sm">
            {emptyMessage ?? "No locations to show"}
          </p>
        </div>
      ) : null}

      {ready ? <MapAttribution /> : null}
    </div>
  );
}

/**
 * OpenStreetMap attribution, rendered by us rather than by MapLibre.
 *
 * Two reasons, one legal and one practical.
 *
 * The legal one: OSM's tile usage policy requires visible attribution. It is not
 * decorative and it does not go away when the map is panned or zoomed, so it is
 * pinned to the corner rather than left to the control's compact toggle.
 *
 * The practical one: the built-in control's links are underlined by nothing and
 * differ from surrounding text only in colour, which fails WCAG 1.4.1. Ours are
 * underlined, meet the 4.5:1 contrast threshold in slate-700, and sit on a solid
 * plate so they stay readable over both the pale basemap and a coloured route
 * line.
 */
function MapAttribution() {
  return (
    <div className="pointer-events-none absolute bottom-0 right-0 z-10">
      <p className="pointer-events-auto rounded-tl-lg bg-white/85 px-2 py-1 text-[10px] leading-tight text-slate-700 backdrop-blur-sm">
        Map data{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium underline decoration-slate-400 underline-offset-2 hover:decoration-slate-700"
        >
          © OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  );
}

/** Placeholder shown until the map has a size and WebGL has initialised. */
function MapSkeleton({ height }: { height: string }) {
  return (
    <div
      style={{ height }}
      className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100"
      aria-hidden
    />
  );
}

/**
 * Index of the geographically closest stop other than `exceptId`.
 *
 * Only reachable when there is no path to project onto, which in practice means
 * a route with fewer than two stops. Keeping the fallback means a reorder
 * gesture degrades to "nearest other stop" instead of doing nothing at all.
 */
function nearestOtherStopIndex(stops: MapStop[], exceptId: string, at: LatLng): number {
  let best = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    if (stop.id === exceptId) continue;
    const distance = haversineMeters(at, { lat: stop.lat, lng: stop.lng });
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Only allow a link that stays inside this app.
 *
 * Returns null for anything absolute, protocol-relative, or carrying a scheme.
 * A vehicle's `href` originates from a socket payload, and a popup is built as
 * an HTML string — so without this check a crafted value could render
 * `<a href="javascript:…">` or point a parent at a look-alike domain, and an
 * escaping pass alone would not help, because those are valid hrefs.
 */
function localHref(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\s"'<>]/.test(value)) return null;
  return value;
}

/** Popups are built as HTML, so every interpolated value is escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
