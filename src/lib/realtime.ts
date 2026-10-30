"use client";

/**
 * Browser side of the realtime layer.
 *
 * Uses Supabase Realtime Broadcast on Vercel. Falls back to Socket.IO if available.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { EV, SOCKET_PATH, type BusLocationPayload, type StopArrivalPayload } from "@/lib/socket-events";
import { getBusChannel, getFleetChannel, getSupabaseClient } from "@/lib/realtime-supabase/client";

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

export function resetSocketForTests() {
  socket?.disconnect();
  socket = null;
  connState = "connecting";
}

export function useSocketConnection(): ConnectionState {
  if (typeof window !== "undefined" && !socket) {
    // Try to get socket for fallback, but don't block on it
    try {
      getSocket();
    } catch {
      // ignore
    }
  }
  return useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    getConnectionSnapshot,
  );
}

export function emitToServer(event: string, payload?: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    const s = getSocket();
    if (payload === undefined) s.emit(event);
    else s.emit(event, payload);
    return s.connected;
  } catch {
    return false;
  }
}

export function listenOnSocket<T>(event: string, handler: (payload: T) => void): () => void {
  try {
    const s = getSocket();
    const wrapped = (payload: T) => handler(payload);
    s.on(event, wrapped);
    return () => {
      s.off(event, wrapped);
    };
  } catch {
    return () => {};
  }
}

export function useBusLocation(
  busId: string | null,
  onLocation: (payload: BusLocationPayload) => void,
): void {
  const latest = useRef(onLocation);

  useEffect(() => {
    latest.current = onLocation;
  });

  useEffect(() => {
    if (!busId) return;

    let unsubSocket: (() => void) | null = null;
    let channel: ReturnType<typeof getBusChannel> | null = null;

    // Try Supabase first
    try {
      channel = getBusChannel(busId);
      channel.on("broadcast", { event: EV.busLocation }, ({ payload }) => {
        const p = payload as BusLocationPayload;
        if (p?.busId === busId) latest.current(p);
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          publish("live");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          publish("offline");
        }
      });
    } catch {
      // fall through to socket
    }

    // Fallback to socket
    try {
      const s = getSocket();
      const handler = (payload: BusLocationPayload) => {
        if (payload.busId === busId) latest.current(payload);
      };
      s.on(EV.busLocation, handler);
      s.emit(EV.watchSubscribe, { busId });
      unsubSocket = () => {
        s.off(EV.busLocation, handler);
        s.emit(EV.watchUnsubscribe, { busId });
      };
    } catch {
      // ignore
    }

    return () => {
      unsubSocket?.();
      if (channel) {
        try {
          getSupabaseClient().removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, [busId]);
}

export function useStopArrivals(onArrival: (payload: StopArrivalPayload) => void): void {
  const latest = useRef(onArrival);

  useEffect(() => {
    latest.current = onArrival;
  });

  useEffect(() => {
    let unsubSocket: (() => void) | null = null;
    let channel: ReturnType<typeof getFleetChannel> | null = null;

    try {
      channel = getFleetChannel();
      channel.on("broadcast", { event: EV.stopArrival }, ({ payload }) => {
        latest.current(payload as StopArrivalPayload);
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") publish("live");
      });
    } catch {
      // ignore
    }

    try {
      const s = getSocket();
      const handler = (payload: StopArrivalPayload) => latest.current(payload);
      s.on(EV.stopArrival, handler);
      unsubSocket = () => {
        s.off(EV.stopArrival, handler);
      };
    } catch {
      // ignore
    }

    return () => {
      unsubSocket?.();
      if (channel) {
        try {
          getSupabaseClient().removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, []);
}
