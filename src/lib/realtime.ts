"use client";

/**
 * Browser side of the realtime layer.
 *
 * One socket per browser tab, shared by every component that needs it. It is
 * deliberately a page-lifetime singleton rather than something each component
 * opens and closes: navigating from the dashboard to the live map unmounts and
 * remounts components, and tearing the connection down each time produces a
 * visible reconnect gap and a burst of re-subscriptions. Socket.IO already
 * reconnects with backoff, and closing a socket the user still needs is worse
 * than keeping one open for the life of the tab.
 *
 * Connection state is published through `useSyncExternalStore` rather than
 * `useState` + effect, so a component that mounts while the socket is already
 * connected reads the right value immediately instead of flashing "connecting".
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { EV, SOCKET_PATH, type BusLocationPayload } from "@/lib/socket-events";

export type ConnectionState = "connecting" | "live" | "offline";

let socket: Socket | null = null;
let connState: ConnectionState = "connecting";
const listeners = new Set<() => void>();

function publish(next: ConnectionState) {
  if (next === connState) return;
  connState = next;
  for (const listener of listeners) listener();
}

function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getConnectionSnapshot(): ConnectionState {
  return connState;
}

function getSocket(): Socket {
  if (socket) return socket;

  connState = "connecting";
  socket = io({
    path: SOCKET_PATH,
    // Same-origin, so the httpOnly session cookie rides along automatically.
    // There is no token in localStorage for XSS to steal.
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  socket.on("connect", () => publish("live"));
  socket.on("disconnect", () => publish("offline"));
  socket.on("connect_error", () => publish("offline"));

  return socket;
}

/** For tests and for the server: drop the singleton. */
export function resetSocketForTests() {
  socket?.disconnect();
  socket = null;
  connState = "connecting";
}

export function useSocketConnection(): ConnectionState {
  // Touching the getter inside render is what creates the socket on first use.
  if (typeof window !== "undefined" && !socket) getSocket();
  return useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    getConnectionSnapshot,
  );
}

/**
 * Send a client -> server event on the shared socket.
 *
 * Returns false when there is no socket yet, so a caller that fires before the
 * connection is up can decide whether the event needs to be re-sent later.
 * Creating the socket here is deliberate: the same page-lifetime singleton, or
 * a second socket with its own reconnection backoff.
 */
export function emitToServer(event: string, payload?: unknown): boolean {
  if (typeof window === "undefined") return false;
  const s = getSocket();
  if (payload === undefined) s.emit(event);
  else s.emit(event, payload);
  return s.connected;
}

/**
 * Listen for a server event on the shared socket. Returns an unsubscribe
 * function, so a component that unmounts leaves nothing behind — this is the
 * imperative counterpart to `useBusLocation` for the driver panel, which needs
 * `driver:start` and the `server:error` reply rather than a bus subscription.
 */
export function listenOnSocket<T>(event: string, handler: (payload: T) => void): () => void {
  const s = getSocket();
  const wrapped = (payload: T) => handler(payload);
  s.on(event, wrapped);
  return () => {
    s.off(event, wrapped);
  };
}

/**
 * Watch one bus. The callback fires on every position the server broadcasts,
 * which is throttled to at most once every two seconds per driver.
 */
export function useBusLocation(
  busId: string | null,
  onLocation: (payload: BusLocationPayload) => void,
): void {
  const latest = useRef(onLocation);

  // Keep the callback fresh without re-subscribing the socket on every render.
  useEffect(() => {
    latest.current = onLocation;
  });

  useEffect(() => {
    if (!busId) return;

    const s = getSocket();
    const handler = (payload: BusLocationPayload) => {
      if (payload.busId === busId) latest.current(payload);
    };

    s.on(EV.busLocation, handler);
    s.emit(EV.watchSubscribe, { busId });

    return () => {
      s.off(EV.busLocation, handler);
      s.emit(EV.watchUnsubscribe, { busId });
    };
  }, [busId]);
}
