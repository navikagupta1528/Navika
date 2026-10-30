/**
 * Server-side realtime emitters.
 *
 * Swapped to Supabase Realtime Broadcast so it works on Vercel (serverless).
 * Falls back to Socket.IO if present for local dev with the custom server.
 */
import type { Server } from "socket.io";
import {
  EV,
  ROOM,
  type BusLocationPayload,
  type StopArrivalPayload,
} from "@/lib/socket-events";
import {
  broadcastToBus,
  broadcastToFleet,
  broadcastToUser,
} from "@/lib/realtime-supabase/server";

let ioRef: Server | null = null;

/** Called once by the custom server, right after the socket server exists. */
export function setSocketServer(io: Server): void {
  ioRef = io;
}

export function pushBusLocation(payload: BusLocationPayload): void {
  if (ioRef) {
    ioRef.to(ROOM.bus(payload.busId)).emit(EV.busLocation, payload);
    return;
  }
  void broadcastToBus(payload.busId, EV.busLocation, payload);
}

export function pushAlert(busId: string, payload: unknown): void {
  if (ioRef) {
    ioRef.to(ROOM.bus(busId)).emit(EV.busAlert, payload);
    return;
  }
  void broadcastToBus(busId, EV.busAlert, payload);
}

export function pushPickupUpdate(busId: string, payload: unknown): void {
  if (ioRef) {
    ioRef.to(ROOM.bus(busId)).emit(EV.pickupUpdate, payload);
    return;
  }
  void broadcastToBus(busId, EV.pickupUpdate, payload);
}

/**
 * Tell watchers a bus reached a stop.
 */
export function pushStopArrival(payload: StopArrivalPayload): void {
  if (ioRef) {
    ioRef.to(ROOM.bus(payload.busId)).emit(EV.stopArrival, payload);
    ioRef.to(ROOM.fleet).emit(EV.stopArrival, payload);
    return;
  }
  void broadcastToBus(payload.busId, EV.stopArrival, payload);
  void broadcastToFleet(EV.stopArrival, payload);
}

export function pushToUser(userId: string, event: string, payload: unknown): void {
  if (ioRef) {
    ioRef.to(ROOM.user(userId)).emit(event, payload);
    return;
  }
  void broadcastToUser(userId, event, payload);
}
