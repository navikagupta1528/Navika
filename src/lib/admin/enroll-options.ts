import "server-only";
import { prisma } from "@/lib/db";

/**
 * Option lists for the enrolment form.
 *
 * Returned in one query rather than three so the dependent stop list can be
 * filtered on the client: the admin picks a bus, and the stop dropdown narrows
 * to the stops that bus actually serves, instead of offering 12 stops of which
 * 9 are wrong for the chosen route.
 */
export async function getEnrollOptions() {
  const [students, buses] = await Promise.all([
    prisma.studentProfile.findMany({
      orderBy: { enrollmentNo: "asc" },
      select: {
        id: true,
        enrollmentNo: true,
        user: { select: { name: true, email: true, isActive: true } },
      },
    }),
    prisma.bus.findMany({
      where: { status: { not: "INACTIVE" } },
      orderBy: { busNumber: "asc" },
      select: {
        id: true,
        busNumber: true,
        registrationNo: true,
        capacity: true,
        status: true,
        route: {
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
            routeStops: {
              orderBy: { stopOrder: "asc" },
              select: {
                stop: { select: { id: true, name: true, isActive: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    students: students.map((s) => ({
      id: s.id,
      label: `${s.user.name} · ${s.enrollmentNo}`,
      disabled: !s.user.isActive,
    })),
    buses: buses.map((b) => ({
      id: b.id,
      label: `${b.busNumber} · ${b.route ? b.route.name : "no route"}`,
      capacity: b.capacity,
      // Stops this bus actually stops at, in the order it visits them.
      stops: (b.route?.routeStops ?? []).map((rs, i) => ({
        id: rs.stop.id,
        label: `${i + 1}. ${rs.stop.name}`,
        disabled: !rs.stop.isActive,
      })),
      hasRoute: Boolean(b.route && b.route.routeStops.length > 0 && b.route.isActive),
    })),
  };
}
