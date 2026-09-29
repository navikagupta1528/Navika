/**
 * Socket.IO wiring for live tracking.
 *
 * Design notes:
 *
 *  - Location writes are the hottest path in the product. A bus reporting every
 *    5 seconds across 40 buses is 8 writes a second, which is fine for Postgres
 *    but wasteful if every write also hits every subscriber. So we broadcast on
 *    every ping and persist on a slower, separate cadence (see PERSIST_EVERY_MS).
 *
 *  - Rooms, not per-socket subscriptions. A student watching a bus joins
 *    `bus:<id>`; the driver joins `driver:<id>` and publishes into it. Leaving
 *    a room on disconnect is handled by Socket.IO itself, so we never have to
 *    clean up a registry of sockets.
 *
 *  - The driver's bus is resolved from the database, never from the payload.
 *    A compromised driver client cannot move a bus it was not assigned to.
 */
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { prisma } from "@/lib/db";
import { decryptSession } from "@/server/session-core";
import {
  EV,
  ROOM,
  SOCKET_PATH,
  type BusLocationPayload,
  type DriverLocationPayload,
  type SocketErrorPayload,
} from "@/lib/socket-events";

/** Reject a position update closer together than this, per socket. */
const MIN_PING_INTERVAL_MS = 2_000;
/** Only write to Postgres this often, even if pings arrive faster. */
const PERSIST_EVERY_MS = 15_000;
/** Positions older than this are treated as a stale bus. */
export const STALE_AFTER_MS = 2 * 60_000;

type SocketData = {
  userId: string;
  role: "STUDENT" | "PARENT" | "DRIVER" | "ADMIN";
  busId: string | null;
  lastPingAt: number;
  lastPersistAt: number;
};

type Watched = Socket & { data: SocketData };

function fail(socket: Socket, code: SocketErrorPayload["code"], message: string) {
  socket.emit(EV.serverError, { code, message } satisfies SocketErrorPayload);
}

/** Which bus is this driver actually assigned to right now? */
async function resolveDriverBus(userId: string): Promise<string | null> {
  const assignment = await prisma.busDriver.findFirst({
    where: {
      driverId: userId,
      OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
    },
    orderBy: { validFrom: "desc" },
    select: { busId: true },
  });
  return assignment?.busId ?? null;
}

export function attachSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    // Next.js owns the page routes; Socket.IO only listens on its own path.
    path: SOCKET_PATH,
    serveClient: false,
    cors: { origin: false },
    // A driver on a phone in a tunnel loses connection constantly. Allow a
    // longish window so a reconnecting bus is not treated as a new driver.
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 1e5,
  });

  // -------------------------------------------------------------------------
  // Authentication: the session cookie is the only credential. There is no
  // token in localStorage to steal via XSS.
  // -------------------------------------------------------------------------
  io.use(async (socket, next) => {
    const raw = socket.handshake.headers.cookie ?? "";
    const match = raw
      .split(";")
      .map((c) => c.trim().split("="))
      .find(([name]) => name === "navika_session");

    const session = await decryptSession(match?.[1]);
    if (!session) {
      next(new Error("unauthorized"));
      return;
    }

    const data: SocketData = {
      userId: session.userId,
      role: session.role,
      busId: null,
      lastPingAt: 0,
      lastPersistAt: 0,
    };
    socket.data = data;
    next();
  });

  io.on("connection", (socket: Watched) => {
    void socket.join(ROOM.user(socket.data.userId));
    if (socket.data.role === "ADMIN") void socket.join(ROOM.fleet);

    // -----------------------------------------------------------------------
    // Watch a bus (students, parents, admin)
    // -----------------------------------------------------------------------
    socket.on(EV.watchSubscribe, async (raw: { busId?: unknown }) => {
      const busId = typeof raw?.busId === "string" ? raw.busId : null;
      if (!busId) {
        fail(socket, "BAD_REQUEST", "busId is required");
        return;
      }

      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        select: { id: true, currentLat: true, currentLng: true, lastLocationAt: true },
      });
      if (!bus) {
        fail(socket, "BAD_REQUEST", "Unknown bus");
        return;
      }

      await socket.join(ROOM.bus(busId));

      // Send the last known position immediately so the map is never blank
      // while waiting for the driver's next ping.
      if (bus.currentLat != null && bus.currentLng != null) {
        socket.emit(EV.busLocation, {
          busId: bus.id,
          lat: bus.currentLat,
          lng: bus.currentLng,
          speedKph: null,
          headingDeg: null,
          onboardCount: 0,
          at: bus.lastLocationAt?.getTime() ?? Date.now(),
        } satisfies BusLocationPayload);
      }
    });

    socket.on(EV.watchUnsubscribe, async (raw: { busId?: unknown }) => {
      const busId = typeof raw?.busId === "string" ? raw.busId : null;
      if (busId) await socket.leave(ROOM.bus(busId));
    });

    // -----------------------------------------------------------------------
    // Driver: start / stop sharing
    // -----------------------------------------------------------------------
    socket.on(EV.driverStart, async () => {
      if (socket.data.role !== "DRIVER") {
        fail(socket, "NOT_DRIVER", "Only drivers can share a location");
        return;
      }

      const busId = await resolveDriverBus(socket.data.userId);
      if (!busId) {
        fail(socket, "NO_BUS", "No bus is assigned to you right now");
        return;
      }

      socket.data.busId = busId;
      socket.data.lastPersistAt = 0;
      await socket.join(ROOM.driver(busId));

      const trip = await prisma.trip.findFirst({
        where: { busId, status: "ONGOING" },
        orderBy: { startedAt: "desc" },
        select: { id: true, status: true, startedAt: true, endedAt: true },
      });
      socket.emit(EV.tripUpdate, trip ?? { status: "NONE" });
    });

    socket.on(EV.driverStop, async () => {
      const busId = socket.data.busId;
      if (!busId) return;
      await socket.leave(ROOM.driver(busId));
      socket.data.busId = null;
      // Mark the bus as no longer reporting, so the UI stops saying "live".
      await prisma.bus.update({ where: { id: busId }, data: { speedKph: null } });
    });

    // -----------------------------------------------------------------------
    // Driver: location ping
    // -----------------------------------------------------------------------
    socket.on(EV.driverLocation, async (raw: DriverLocationPayload) => {
      const busId = socket.data.busId;
      if (!busId) {
        fail(socket, "NO_BUS", "Send driver:start before sending a position");
        return;
      }

      const now = Date.now();
      if (now - socket.data.lastPingAt < MIN_PING_INTERVAL_MS) return;
      socket.data.lastPingAt = now;

      const lat = Number(raw?.lat);
      const lng = Number(raw?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        fail(socket, "BAD_REQUEST", "lat and lng are required");
        return;
      }
      // Reject junk from a phone with a broken fix rather than teleporting
      // the bus across the map.
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        fail(socket, "BAD_REQUEST", "Coordinates out of range");
        return;
      }

      const speedKph =
        typeof raw.speedKph === "number" && raw.speedKph >= 0
          ? Math.min(raw.speedKph, 200)
          : null;
      const headingDeg =
        typeof raw.headingDeg === "number" && raw.headingDeg >= 0
          ? raw.headingDeg % 360
          : null;

      const onboard = await prisma.pickupRecord.count({
        where: {
          trip: { busId, status: "ONGOING" },
          status: "PICKED",
        },
      });

      // Broadcast always, so the map stays smooth.
      io.to(ROOM.bus(busId)).emit(EV.busLocation, {
        busId,
        lat,
        lng,
        speedKph,
        headingDeg,
        onboardCount: onboard,
        at: now,
      } satisfies BusLocationPayload);

      // Persist on a slower cadence.
      if (now - socket.data.lastPersistAt < PERSIST_EVERY_MS) return;
      socket.data.lastPersistAt = now;

      await prisma.bus.update({
        where: { id: busId },
        data: {
          currentLat: lat,
          currentLng: lng,
          speedKph,
          headingDeg,
          lastLocationAt: new Date(now),
          onboardCount: onboard,
        },
      });
    });
  });

  return io;
}

// ---------------------------------------------------------------------------
// Server-side emitters, used by Route Handlers and Server Actions so a write
// from anywhere (REST, cron, admin form) pushes to connected clients too.
// ---------------------------------------------------------------------------

let ioRef: Server | null = null;

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

export function pushToUser(userId: string, event: string, payload: unknown): void {
  ioRef?.to(ROOM.user(userId)).emit(event, payload);
}
