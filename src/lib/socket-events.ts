/**
 * Shared realtime contract.
 *
 * Both the custom server (`src/server/socket.ts`) and the browser
 * (`src/lib/realtime.ts`) import these names, so a typo cannot silently
 * subscribe to an event nobody emits.
 *
 * This file must stay free of `server-only` and of any `next/*` import: it is
 * loaded by plain Node as well as by the browser bundle.
 */

export const SOCKET_PATH = "/api/socket/io";

/**
 * engine.io appends a trailing slash to its configured path, so the paths that
 * belong to Socket.IO are `/api/socket/io/` and everything under it. The custom
 * server uses this to stay out of the way: without the guard it would also call
 * Next's handler on a request Socket.IO has already answered, which throws
 * ERR_HTTP_HEADERS_SENT.
 */
export function isSocketRequest(url: string | undefined): boolean {
  if (!url) return false;
  return url === SOCKET_PATH || url.startsWith(`${SOCKET_PATH}/`);
}

export const ROOM = {
  /** Everyone currently watching a bus: students, parents, admin. */
  bus: (busId: string) => `bus:${busId}`,
  /** The driver currently driving a bus, plus that bus's watchers. */
  driver: (busId: string) => `driver:${busId}`,
  /** A user's private channel for alerts and pick-up confirmations. */
  user: (userId: string) => `user:${userId}`,
  /** Admins watching the whole fleet. */
  fleet: "fleet",
} as const;

export const EV = {
  // client -> server
  watchSubscribe: "watch:subscribe",
  watchUnsubscribe: "watch:unsubscribe",
  driverStart: "driver:start",
  driverStop: "driver:stop",
  driverLocation: "driver:location",

  // server -> client
  busLocation: "bus:location",
  busAlert: "bus:alert",
  tripUpdate: "trip:update",
  pickupUpdate: "pickup:update",
  stopArrival: "stop:arrival",
  serverError: "server:error",
} as const;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type BusLocationPayload = {
  busId: string;
  lat: number;
  lng: number;
  speedKph: number | null;
  headingDeg: number | null;
  onboardCount: number;
  /** Server clock at emit time, so the client never trusts its own clock. */
  at: number;
};

export type BusAlertPayload = {
  id: string;
  busId: string;
  type: string;
  message: string;
  lat: number | null;
  lng: number | null;
  status: string;
  createdAt: string;
};

export type PickupUpdatePayload = {
  pickupRecordId: string;
  tripId: string;
  studentId: string;
  stopId: string;
  status: string;
  waitingMarkedAt: string | null;
  pickedAt: string | null;
};

/**
 * A bus reaching a stop.
 *
 * Emitted by the simulator, which has no `Trip` to attach a `StopEvent` row to,
 * and so has nothing to say about a stop except over the socket.
 */
export type StopArrivalPayload = {
  busId: string;
  stopId: string;
  stopName: string;
  /** Server clock, for the same reason `BusLocationPayload.at` is. */
  at: number;
  /**
   * True when this came from a simulated bus rather than a driver's phone.
   *
   * Carried so a watching map can label the bus as simulated. Without it a
   * demonstration run is indistinguishable from a real one on screen, which is
   * exactly the confusion the `isSimulated` badge exists to prevent elsewhere.
   */
  simulated: boolean;
};

export type SocketErrorPayload = {
  code: "UNAUTHORIZED" | "BAD_REQUEST" | "NOT_DRIVER" | "NO_BUS" | "INTERNAL";
  message: string;
};

/** Sent by the driver PWA; throttled and validated server side. */
export type DriverLocationPayload = {
  lat: number;
  lng: number;
  speedKph?: number;
  headingDeg?: number;
  accuracyM?: number;
};
