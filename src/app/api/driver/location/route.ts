import { NextResponse } from "next/server";
import { requireRole } from "@/lib/dal";
import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { applyPosition } from "@/server/position-pipeline";
import { type DriverLocationPayload } from "@/lib/socket-events";

const MIN_PING_INTERVAL_MS = 2_000;
const PERSIST_EVERY_MS = 15_000;

const lastPingByUser = new Map<string, number>();
const lastPersistByBus = new Map<string, number>();

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: Request) {
  try {
    const user = await requireRole(Role.DRIVER);

    const now = Date.now();
    const lastPing = lastPingByUser.get(user.userId) ?? 0;
    if (now - lastPing < MIN_PING_INTERVAL_MS) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    lastPingByUser.set(user.userId, now);

    const assignment = await prisma.busDriver.findFirst({
      where: {
        driverId: user.userId,
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
      orderBy: { validFrom: "desc" },
      select: { busId: true },
    });
    if (!assignment?.busId) {
      return fail("NO_BUS", "No bus assigned", 400);
    }
    const busId = assignment.busId;

    let body: DriverLocationPayload;
    try {
      body = (await req.json()) as DriverLocationPayload;
    } catch {
      return fail("BAD_REQUEST", "Invalid JSON", 400);
    }

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fail("BAD_REQUEST", "lat and lng are required", 400);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return fail("BAD_REQUEST", "Coordinates out of range", 400);
    }

    const speedKph =
      typeof body.speedKph === "number" && body.speedKph >= 0
        ? Math.min(body.speedKph, 200)
        : null;
    const headingDeg =
      typeof body.headingDeg === "number" && body.headingDeg >= 0
        ? body.headingDeg % 360
        : null;

    const lastPersist = lastPersistByBus.get(busId) ?? 0;
    const persist = now - lastPersist >= PERSIST_EVERY_MS;
    if (persist) lastPersistByBus.set(busId, now);

    const reportedAt = typeof body?.at === "number" && Number.isFinite(body.at) ? body.at : null;

    await applyPosition({ busId, lat, lng, speedKph, headingDeg, reportedAt, persist });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes("unauthorized")) {
      return fail("UNAUTHORIZED", "Unauthorized", 401);
    }
    return fail("INTERNAL", "Internal error", 500);
  }
}
