import "server-only";

/**
 * Server-side queries for the live tracking screen.
 *
 * The only interesting thing in here is `canWatchBus`. A tracking page is a map
 * with a dot on it, and a map with a dot on it leaks a child's whereabouts to
 * anyone holding the URL. The bus id in the link is a cuid, which is not
 * guessable — but "not guessable" is not authorisation, so every request is
 * checked against the relationship table before anything is returned.
 */

import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/enums";
import { studentScopeFor } from "@/lib/student-scope";

import { getRouteGeometry, getLiveEta } from "@/lib/osrm";
import type { LatLng } from "@/lib/geo";
import { hasPosition, isReportable } from "@/lib/fleet-filter";
import { LIVE_WINDOW_MS } from "@/lib/utils";

export type WatchDenial =
  | "no-bus"
  | "no-route"
  | "not-yours"
  | "no-stop";

export type TrackingView = {
  bus: {
    id: string;
    label: string;
    registrationNo: string;
    onboardCount: number;
    routeName: string;
    routeCode: string;
  };
  stops: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    order: number;
    /** Present only for the viewer's own stop. */
    isViewerStop?: boolean;
    /** True once the bus has a recorded arrival at this stop on this trip. */
    visited?: boolean;
  }[];
  geometry: LatLng[];
  distanceMeters: number | null;
  /** The viewer's stop, so the map can say "4 min to Aundh IT Park". */
  viewerStop: { id: string; name: string; lat: number; lng: number } | null;
  /** Null when the bus has no usable position yet. */
  etaMinutes: number | null;
  /** Null when the position is too old to make an estimate from. */
  positionAge: "fresh" | "stale" | "none";
  lastPosition: { lat: number; lng: number; at: Date } | null;
  trip: { id: string; status: string; direction: string; startedAt: Date | null } | null;
};

/**
 * Is this user entitled to watch this bus?
 *
 *  - A student may watch only the bus they are enrolled on.
 *  - A parent may watch any bus their child is enrolled on. The check goes
 *    through `ParentChild`, not through the child's user account, so a parent
 *    sees every child without needing a second login.
 *  - An admin may watch anything: dispatch is their job.
 *
 * Returns the enrolment that matched, because the caller also needs the stop.
 */
export async function authoriseBusWatch(
  userId: string,
  role: Role,
  busId: string,
): Promise<{ busId: string; stopId: string | null } | null> {
  if (role === Role.ADMIN) {
    const bus = await prisma.bus.findUnique({ where: { id: busId }, select: { id: true } });
    // No stop: an admin watches the whole route, not one boarding point.
    return bus ? { busId: bus.id, stopId: null } : null;
  }

  // Both roles are answered by the same question: does this user have an active
  // enrolment on this bus? The only difference is which student rows count.
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      busId,
      isActive: true,
      student: studentScopeFor(userId, role),
    },
    select: { busId: true, stopId: true },
  });

  return enrollment;
}

/**
 * Everything the tracking page renders, in one place.
 *
 * Returns a typed denial rather than throwing, because the page has to say
 * *why* it cannot show the map. Redirecting a parent who followed a stale link
 * to their dashboard with no explanation looks like a broken site.
 */
export async function getTrackingView(
  userId: string,
  role: Role,
  busId: string,
): Promise<{ view: TrackingView } | { denial: WatchDenial }> {
  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: {
      id: true,
      busNumber: true,
      registrationNo: true,
      onboardCount: true,
      currentLat: true,
      currentLng: true,
      lastLocationAt: true,
      routeId: true,
      route: {
        select: {
          id: true,
          name: true,
          code: true,
          routeStops: {
            orderBy: { stopOrder: "asc" },
            select: {
              stopOrder: true,
              scheduledHHMM: true,
              stop: { select: { id: true, name: true, lat: true, lng: true, isActive: true } },
            },
          },
        },
      },
    },
  });

  if (!bus) return { denial: "no-bus" };
  if (!bus.route) return { denial: "no-route" };

  const access = await authoriseBusWatch(userId, role, busId);
  // Checked *after* the bus lookup so an unauthorised user learns nothing about
  // whether the bus exists: both cases land on the same page.
  if (!access) return { denial: "not-yours" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const trip = await prisma.trip.findFirst({
    where: { busId, date: { gte: today, lt: tomorrow } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      direction: true,
      startedAt: true,
      stopEvents: { select: { stopId: true, arrivedAt: true } },
    },
  });

  const visited = new Set(
    (trip?.stopEvents ?? []).filter((e) => e.arrivedAt).map((e) => e.stopId),
  );

  const stops = bus.route.routeStops.map((rs) => ({
    id: rs.stop.id,
    name: rs.stop.name,
    lat: rs.stop.lat,
    lng: rs.stop.lng,
    order: rs.stopOrder,
    isViewerStop: role !== Role.ADMIN && access.stopId === rs.stop.id,
    visited: visited.has(rs.stop.id),
  }));

  if (role !== Role.ADMIN && !stops.some((s) => s.isViewerStop)) {
    // The enrolment points at a stop that is no longer on the route. Showing
    // the map with no "your stop" would quietly answer the wrong question, so
    // say so instead.
    return { denial: "no-stop" };
  }

  const viewerStop = stops.find((s) => s.isViewerStop) ?? null;

  const line = await getRouteGeometry(stops.map((s) => ({ lat: s.lat, lng: s.lng })));

  const hasPosition =
    bus.currentLat !== null && bus.currentLng !== null && bus.lastLocationAt !== null;
  const positionAge: TrackingView["positionAge"] = !hasPosition
    ? "none"
    : Date.now() - bus.lastLocationAt!.getTime() > LIVE_WINDOW_MS
      ? "stale"
      : "fresh";

  // An ETA from a position that is minutes old is worse than no ETA at all: it
  // will confidently say "arriving" about a bus that stopped reporting an hour
  // ago. So the staleness gate lives here, before the estimate is computed.
  let etaMinutes: number | null = null;
  if (positionAge === "fresh" && viewerStop) {
    const eta = await getLiveEta(
      { lat: bus.currentLat!, lng: bus.currentLng! },
      { lat: viewerStop.lat, lng: viewerStop.lng },
    );
    etaMinutes = Math.max(1, Math.round(eta.seconds / 60));
  }

  return {
    view: {
      bus: {
        id: bus.id,
        label: bus.busNumber,
        registrationNo: bus.registrationNo,
        onboardCount: bus.onboardCount,
        routeName: bus.route.name,
        routeCode: bus.route.code,
      },
      stops,
      geometry: line?.line ?? stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      distanceMeters: line?.meters ?? null,
      viewerStop: viewerStop
        ? { id: viewerStop.id, name: viewerStop.name, lat: viewerStop.lat, lng: viewerStop.lng }
        : null,
      etaMinutes,
      positionAge,
      lastPosition: hasPosition
        ? { lat: bus.currentLat!, lng: bus.currentLng!, at: bus.lastLocationAt! }
        : null,
      trip: trip
        ? {
            id: trip.id,
            status: trip.status,
            direction: trip.direction,
            startedAt: trip.startedAt,
          }
        : null,
    },
  };
}

/**
 * Which of the given buses is this viewer allowed to open a tracking page for.
 *
 * The fleet map shows every reporting bus, because knowing where the rest of
 * the fleet is is useful even to a parent who cannot follow it. But the
 * tracking page is per-bus and per-stop, and it refuses anyone not enrolled on
 * that bus. So the list needs to know which links would actually work —
 * otherwise the fleet page offers a "follow" button that resolves to an error
 * page, which reads as a broken product rather than a deliberate refusal.
 */
export async function getWatchableBusIds(
  userId: string,
  role: Role,
): Promise<Set<string> | "all"> {
  if (role === Role.ADMIN) return "all";

  const rows = await prisma.enrollment.findMany({
    where: { isActive: true, student: studentScopeFor(userId, role) },
    select: { busId: true },
  });

  return new Set(rows.map((r) => r.busId));
}

/** One bus on the fleet map, flattened for the client component. */
export type FleetPosition = {
  busId: string;
  label: string;
  registrationNo: string;
  lat: number;
  lng: number;
  heading: number | null;
  onboardCount: number;
  isSimulated: boolean;
  routeName: string | null;
  routeId: string | null;
  tripId: string | null;
  direction: string | null;
  startedAt: Date | null;
  at: Date;
};

/**
 * Every bus that has moved recently, for the admin and parent fleet maps.
 *
 * Bounded by `LIVE_WINDOW_MS` on purpose: a fleet map that plots buses from
 * last Tuesday is a map of where buses used to be, and it would look live. The
 * bound is in SQL because this query would otherwise return the whole fleet;
 * `isReportable` then re-applies the identical rule in TypeScript so the two
 * cannot quietly drift apart — see `fleet-filter.ts`.
 *
 * The clock is read *here* and returned as `asOf`, rather than left to each
 * caller. A component that called `Date.now()` itself would be reading a second
 * clock a moment after this query ran, so a bus that aged past the window
 * between the two reads would be filtered by one and not the other. One instant,
 * used by both, is the only way they can agree.
 */
export async function getFleetPositions(nowMs: number = Date.now()): Promise<{
  asOf: number;
  buses: FleetPosition[];
}> {
  const cutoff = new Date(nowMs - LIVE_WINDOW_MS);

  const buses = await prisma.bus.findMany({
    where: { lastLocationAt: { gte: cutoff }, status: "ACTIVE" },
    orderBy: { lastLocationAt: "desc" },
    select: {
      id: true,
      busNumber: true,
      registrationNo: true,
      currentLat: true,
      currentLng: true,
      headingDeg: true,
      lastLocationAt: true,
      onboardCount: true,
      isSimulated: true,
      routeId: true,
      route: { select: { id: true, name: true, code: true } },
      trips: {
        where: { status: "ONGOING" },
        take: 1,
        select: { id: true, direction: true, startedAt: true },
      },
    },
  });

  const reportable = buses.filter(
    (b): b is typeof b & { currentLat: number; currentLng: number; lastLocationAt: Date } =>
      hasPosition(b) && isReportable(b, nowMs),
  );

  return {
    asOf: nowMs,
    buses: reportable.map((b) => ({
      busId: b.id,
      label: b.busNumber,
      registrationNo: b.registrationNo,
      lat: b.currentLat,
      lng: b.currentLng,
      heading: b.headingDeg,
      onboardCount: b.onboardCount,
      isSimulated: b.isSimulated,
      routeName: b.route?.name ?? null,
      routeId: b.routeId,
      tripId: b.trips[0]?.id ?? null,
      direction: b.trips[0]?.direction ?? null,
      startedAt: b.trips[0]?.startedAt ?? null,
      at: b.lastLocationAt,
    })),
  };
}
