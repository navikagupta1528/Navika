/**
 * Server-side socket emitters.
 *
 * Every write that originates outside a live socket - a Server Action, a Route
 * Handler, a background watcher - reaches connected clients through here. These
 * used to live at the bottom of `socket.ts`, but that file also imports the
 * position pipeline, and the pipeline needs to push a broadcast. Keeping the
 * emitters and the connection wiring in one module made that a circular import
 * between `socket.ts` and `position-pipeline.ts`. Splitting the outbound side out
 * breaks the cycle honestly rather than relying on it resolving at call time.
 *
 * Plain Node, no `server-only`: the custom server loads it directly.
 */
import type { Server } from "socket.io";
import {
  EV,
  ROOM,
  type BusLocationPayload,
  type StopArrivalPayload,
} from "@/lib/socket-events";

let ioRef: Server | null = null;

/** Called once by the custom server, right after the socket server exists. */
export function setSocketServer(io: Server): void {
  ioRef = io;
}

export function pushBusLocation(payload: BusLocationPayload): void {
  ioRef?.to(ROOM.bus(payload.busId)).emit(EV.busLocation, payload);
}

export function pushAlert(busId: string, payload: unknown): void {
  ioRef?.to(ROOM.bus(busId)).emit(EV.busAlert, payload);
}

export function pushPickupUpdate(busId: string, payload: unknown): void {
  ioRef?.to(ROOM.bus(busId)).emit(EV.pickupUpdate, payload);
}

/**
 * Tell watchers a bus reached a stop.
 *
 * Emitted to the fleet room as well as the bus room, because the fleet map is the
 * screen most likely to be open when nothing is being watched individually, and a
 * bus that visibly pulls into Gate 1 is most of what makes a demo legible.
 */
export function pushStopArrival(payload: StopArrivalPayload): void {
  if (!ioRef) return;
  ioRef.to(ROOM.bus(payload.busId)).emit(EV.stopArrival, payload);
  ioRef.to(ROOM.fleet).emit(EV.stopArrival, payload);
}

export function pushToUser(userId: string, event: string, payload: unknown): void {
  ioRef?.to(ROOM.user(userId)).emit(event, payload);
}
