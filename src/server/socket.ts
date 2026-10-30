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
import { applyPosition } from "@/server/position-pipeline";
import { redisAdapterUrl, scalingNotice } from "@/lib/realtime-scaling";
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

  /*
   * Share broadcasts across instances when a Redis URL is configured.
   *
   * Opt-in on purpose: the single-instance deployment this project actually
   * ships needs no Redis, and with `REDIS_URL` unset this returns immediately.
   * Not awaited - the dynamic import and the connection must not hold up the
   * `listen()` that follows in `server.ts`. The window before the adapter is
   * attached is a few milliseconds at boot, during which rooms are local-only.
   */
  void attachRedisAdapter(io);

  // -------------------------------------------------------------------------
  // Authentication: the session cookie is the only credential. There is no
  // token in localStorage to steal via XSS.
  // -------------------------------------------------------------------------
  io.use(async (socket, next) => {
    const raw = socket.handshake.headers.cookie ?? "";
    const match = raw
      .split(";")
      .map((c) => c.trim().split("="))
      .find(([name]) => name === "busguard_session");

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

      // Persist on a slower cadence than the ping. The broadcast, the onboard
      // count, the write and the three watchers all live in `applyPosition`,
      // shared with the hardware ingestion path so the two cannot drift.
      const persist = now - socket.data.lastPersistAt >= PERSIST_EVERY_MS;
      if (persist) socket.data.lastPersistAt = now;

      const reportedAt = typeof raw?.at === "number" && Number.isFinite(raw.at) ? raw.at : null;

      await applyPosition({ busId, lat, lng, speedKph, headingDeg, reportedAt, persist });
    });
  });

  return io;
}

// ---------------------------------------------------------------------------
// Multi-instance broadcasting
// ---------------------------------------------------------------------------

let closeScaling: (() => Promise<void>) | null = null;

/**
 * Attach the Socket.IO Redis adapter when `REDIS_URL` is set, or do nothing.
 *
 * One process broadcasts to its own clients for free; two process do not, and
 * the failure is invisible because every page still renders and nothing logs an
 * error. A driver on instance A moves a bus and a parent on instance B watches a
 * frozen map. The Redis adapter is Socket.IO's standard answer, and this is the
 * whole of the integration.
 *
 * The import is dynamic so the two Redis packages are only loaded when actually
 * used, and any failure here degrades to the single-instance behaviour this app
 * shipped with rather than preventing boot. That matters because a bad
 * `REDIS_URL` must not take the whole school's app down.
 */
async function attachRedisAdapter(io: Server): Promise<void> {
  const url = redisAdapterUrl(process.env.REDIS_URL);
  if (!url) {
    console.log(`  ${scalingNotice(process.env.REDIS_URL)}`);
    return;
  }

  try {
    const [{ createAdapter }, { createClient }] = await Promise.all([
      import("@socket.io/redis-adapter"),
      import("redis"),
    ]);

    const pub = createClient({ url });
    // A dedicated subscriber connection: a connection with active subscriptions
    // cannot issue normal commands, which is a trap Redis adapters hit first.
    const sub = pub.duplicate();

    for (const client of [pub, sub]) {
      // Without a listener, an ioredis-style client emits an unhandled 'error'
      // on a dropped connection and takes the process down.
      client.on("error", (error: unknown) => {
        console.warn(
          "  realtime: Redis client error:",
          error instanceof Error ? error.message : error,
        );
      });
      await client.connect();
    }

    io.adapter(createAdapter(pub, sub));
    closeScaling = async () => {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    };

    console.log(`  ${scalingNotice(process.env.REDIS_URL)}`);
  } catch (error) {
    console.warn(
      "  realtime: Redis adapter could not be attached; staying single-instance:\n",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Close the shared adapter's Redis connections on shutdown.
 *
 * Called from the custom server's signal handler. Without it the open sockets
 * keep the process alive until the platform force-kills it, which shows up as a
 * 30-second hang on every deploy.
 */
export async function closeRealtimeScaling(): Promise<void> {
  if (closeScaling) await closeScaling();
}
