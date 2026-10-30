import { NextResponse } from "next/server";
import { requireRole } from "@/lib/dal";
import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    const user = await requireRole(Role.DRIVER);
    const assignment = await prisma.busDriver.findFirst({
      where: {
        driverId: user.userId,
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
      orderBy: { validFrom: "desc" },
      select: { busId: true },
    });
    if (!assignment?.busId) {
      return NextResponse.json({ error: { code: "NO_BUS", message: "No bus assigned" } }, { status: 400 });
    }
    const trip = await prisma.trip.findFirst({
      where: { busId: assignment.busId, status: "ONGOING" },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true, endedAt: true },
    });
    return NextResponse.json({ busId: assignment.busId, trip: trip ?? { status: "NONE" } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("unauthorized")) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }
    return NextResponse.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
  }
}
