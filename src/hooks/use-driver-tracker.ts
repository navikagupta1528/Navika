"use client";

/**
 * The driver's side of live tracking.
 *
 * The driver opens the app on a phone clamped to the dashboard, taps "share
 * location", and this hook streams `watchPosition` readings to the server until
 * they tap stop. Everything clever about *which* readings to believe lives in
 * `@/lib/tracking` and is unit-tested; this file is only the plumbing that
 * connects the browser API to the socket.
 *
 * Two things this deliberately does not do:
 *
 *  - It never calls `getCurrentPosition` and then forgets. A single reading
 *    would make the bus jump on every page load and then stop moving, which is
 *    worse than a bus that is honestly still at its first stop.
 *  - It never sends a reading that fails the acceptance rules in `tracking.ts`.
 *    The server validates too, but a rejected fix never leaves the phone, so
 *    there is nothing to persist and nothing to roll back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { emitToServer, listenOnSocket } from "@/lib/realtime";
import {
  EV,
  type DriverLocationPayload,
  type SocketErrorPayload,
} from "@/lib/socket-events";
import {
  fixFromPosition,
  resolveHeadingDeg,
  shouldAcceptFix,
  type Fix,
  type FixRejection,
} from "@/lib/tracking";

export type TrackerStatus =
  /** Not sharing. The default, and the safe resting state. */
  | "idle"
  /** No `navigator.geolocation` at all — an old browser or a test runner. */
  | "unsupported"
  /**
   * The page is not a secure context. Browsers refuse geolocation on plain
   * HTTP, which is worth saying out loud: on a LAN address over `http://` the
   * driver would otherwise just see a button that does nothing.
   */
  | "insecure"
  /** Permission asked for, waiting on the first fix. */
  | "starting"
  /** Streaming. */
  | "sharing"
  /** The user (or the browser) refused location access. */
  | "denied"
  /** No fix could be obtained: indoors, GPS hardware off, satellite denied. */
  | "unavailable"
  /** The server says this driver has no bus assigned. */
  | "no-bus"
  /** The socket dropped. Fixes continue to be buffered by the browser. */
  | "offline";

export type DriverTracker = {
  status: TrackerStatus;
  /** The last reading that passed every check. */
  fix: Fix | null;
  /**
   * Why the most recent reading was thrown away. Surfaced so the panel can say
   * "waiting for a better GPS lock" instead of appearing to have frozen.
   */
  rejected: { reason: FixRejection; at: number } | null;
  /** Human text for the status, ready to render. */
  message: string;
  start: () => void;
  stop: () => void;
};

/**
 * How often we actually transmit. `watchPosition` fires roughly every second
 * when it has a lock; sending all of it wastes battery and radio time for
 * nothing, since two-second resolution is already the server's floor.
 */
const SEND_EVERY_MS = 3_000;

function statusMessage(status: TrackerStatus, fix: Fix | null, rejected: DriverTracker["rejected"]): string {
  switch (status) {
    case "idle":
      return "Not sharing. Parents see the bus only while you share.";
    case "unsupported":
      return "This browser cannot report a location.";
    case "insecure":
      return "Location needs an https:// address. Open the app over https and try again.";
    case "starting":
      return "Asking for permission, then waiting for the first GPS lock…";
    case "sharing": {
      const accuracy = fix ? `±${Math.round(fix.accuracyM)} m` : null;
      if (accuracy) return `Sharing — ${accuracy}`;
      return "Sharing, waiting for a clear fix…";
    }
    case "denied":
      return "Location access is blocked. Allow it in the browser's site settings, then start again.";
    case "unavailable":
      return "No GPS fix available. Move somewhere with a clearer view of the sky.";
    case "no-bus":
      return "You have no bus assigned right now, so there is nothing to share a location for.";
    case "offline":
      return "Connection lost. Your position will resume sending as soon as it is back.";
    default:
      return rejected ? "Some readings were discarded as unreliable." : "";
  }
}

export function useDriverTracker(): DriverTracker {
  const [status, setStatus] = useState<TrackerStatus>("idle");
  const [fix, setFix] = useState<Fix | null>(null);
  const [rejected, setRejected] = useState<DriverTracker["rejected"]>(null);

  const watchId = useRef<number | null>(null);
  const lastSentAt = useRef(0);
  // Kept in refs rather than state: `watchPosition` keeps firing until cleared,
  // and reading a stale closure would resurrect a fix we already rejected.
  const accepted = useRef<Fix | null>(null);
  const active = useRef(false);

  const teardown = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    active.current = false;
    accepted.current = null;
    lastSentAt.current = 0;
  }, []);

  const stop = useCallback(() => {
    teardown();
    emitToServer(EV.driverStop);
    setStatus("idle");
  }, [teardown]);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;

    // The order of these checks is the order a user is most likely to hit them.
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    // `isSecureContext` is false on http:// except for localhost. Chrome allows
    // geolocation on localhost, so testing only that would say "fine" locally
    // and fail for a driver on the college LAN — the exact case this catches.
    if (!window.isSecureContext) {
      setStatus("insecure");
      return;
    }

    active.current = true;
    setStatus("starting");
    setRejected(null);

    // Tell the server to start routing this socket into the bus's rooms. Its
    // reply arrives on `server:error` if the driver has no bus assigned, which
    // is handled below; sending positions before this is answered is harmless
    // because the server rejects them with NO_BUS rather than dropping them.
    emitToServer(EV.driverStart);

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const next = fixFromPosition({
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
          },
          timestamp: position.timestamp,
        });

        if (!next) return;

        const verdict = shouldAcceptFix(accepted.current, next, Date.now());
        if (!verdict.accept) {
          setRejected({ reason: verdict.reason, at: Date.now() });
          return;
        }

        // Resolve the heading *before* overwriting the previous fix. The
        // fallback in `resolveHeadingDeg` is the bearing between the last two
        // accepted fixes, so handing it `prev === next` would compare a point
        // with itself, divide by a zero time delta, and yield no heading at all
        // on exactly the devices that need the fallback.
        const prev = accepted.current;
        const headingDeg = resolveHeadingDeg(prev, next, next.headingDeg);

        accepted.current = next;
        setFix(next);
        setRejected(null);

        // Always transmit the first fix, so a bus appears on the map straight
        // away rather than after the throttle window opens.
        const now = Date.now();
        if (now - lastSentAt.current < SEND_EVERY_MS) return;
        lastSentAt.current = now;

        emitToServer(EV.driverLocation, {
          lat: next.lat,
          lng: next.lng,
          speedKph: next.speedKph ?? undefined,
          headingDeg: headingDeg ?? undefined,
          accuracyM: Number.isFinite(next.accuracyM) ? next.accuracyM : undefined,
          // The fix's own timestamp. If the socket buffers this while out of
          // signal and flushes it later, the server can tell it is a replay and
          // drop it instead of drawing the bus jumping backwards.
          at: next.at,
        } satisfies DriverLocationPayload);
      },
      (error) => {
        // `watchPosition` keeps calling this on every failure, so the guard
        // matters: without it a denied permission spins the state machine.
        if (!active.current) return;
        teardown();
        emitToServer(EV.driverStop);
        setStatus(error.code === 1 ? "denied" : "unavailable");
      },
      {
        enableHighAccuracy: true,
        // Reuse a fix up to 5 s old rather than making the radio work again.
        // Combined with SEND_EVERY_MS this keeps a driver's battery alive
        // through a 45-minute run.
        maximumAge: 5_000,
        timeout: 30_000,
      },
    );
  }, [teardown]);

  // A socket that drops mid-run must not look like a driver who stopped. The
  // server keeps broadcasting nothing and the UI shows the last known position
  // going amber, which is the honest reading.
  useEffect(() => {
    return listenOnSocket<SocketErrorPayload>(EV.serverError, (payload) => {
      if (payload?.code === "NO_BUS" && active.current) {
        teardown();
        setStatus("no-bus");
      }
    });
  }, [teardown]);

  // Unmounting mid-trip must stop the GPS. Without this, the driver navigates
  // away and the bus keeps broadcasting their position from the dashboard.
  useEffect(() => teardown, [teardown]);

  return {
    status,
    fix,
    rejected,
    message: statusMessage(status, fix, rejected),
    start,
    stop,
  };
}
