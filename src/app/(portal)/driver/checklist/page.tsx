import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/enums";
import { getRouteGeometry } from "@/lib/osrm";
import { RouteMap } from "@/components/map/route-map";
import { ChecklistRowView, type ChecklistRow } from "@/components/tracking/checklist-row";
import { PortalShell, PageHeader, type NavItem } from "@/components/portal/portal-shell";
import { Badge, Card, CardTitle, EmptyState, StatTile } from "@/components/ui/primitives";
import { formatTime } from "@/lib/utils";
import { formatDistance } from "@/lib/geo";

export const metadata: Metadata = { title: "Pickup checklist" };

/**
 * The driver's working screen.
 *
 * The nav has pointed here since Phase 1, so the missing page was a dead link
 * for every driver. It is built now because live tracking is only half of the
 * feature: the driver needs to see who is waiting *and* be able to mark them
 * picked up from the same screen, or the "N waiting" badge on the dashboard is
 * just decoration.
 */
export default async function DriverChecklistPage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  const session = await requireRole(Role.DRIVER, Role.ADMIN);
  const { trip: tripParam } = await searchParams;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const baseWhere =
    session.role === Role.ADMIN
      ? { date: { gte: today, lt: tomorrow } }
      : { driverId: session.userId, date: { gte: today, lt: tomorrow } };

  const trips = await prisma.trip.findMany({
    where: baseWhere,
    orderBy: [{ status: "desc" }, { scheduledStart: "asc" }],
    select: {
      id: true,
      status: true,
      direction: true,
      date: true,
      startedAt: true,
      scheduledStart: true,
      bus: { select: { busNumber: true } },
      route: { select: { code: true, name: true } },
      _count: { select: { pickupRecords: true } },
    },
  });

  const nav: NavItem[] = [
    { href: "/driver", label: "Today's trip", icon: "navigate", exact: true },
    { href: "/driver/checklist", label: "Pickup checklist", icon: "clipboard" },
    { href: "/notifications", label: "Notifications", icon: "bell" },
    { href: "/install", label: "Install on phone", icon: "install" },
  ];

  const shell = (children: React.ReactNode) => (
    <PortalShell
      userName={session.role === Role.ADMIN ? "Admin" : "Driver"}
      roleLabel={session.role === Role.ADMIN ? "Admin" : "Driver"}
      nav={nav}
    >
      {children}
    </PortalShell>
  );

  if (trips.length === 0) {
    return shell(
      <>
        <PageHeader title="Pickup checklist" icon="clipboard" />
        <EmptyState
          icon="clipboard"
          title="No trip scheduled today"
          description="Attendance can only be recorded against a trip. When the admin schedules a run for you, it appears here."
        />
      </>,
    );
  }

  // Default to the trip in progress, then the earliest scheduled one. Showing a
  // finished morning trip by default would send the driver back to attendance
  // they have already recorded.
  const selected =
    trips.find((t) => t.id === tripParam) ??
    trips.find((t) => t.status === "ONGOING") ??
    trips.find((t) => t.status === "SCHEDULED") ??
    trips[0]!;

  const trip = await prisma.trip.findUnique({
    where: { id: selected.id },
    select: {
      id: true,
      status: true,
      direction: true,
      startedAt: true,
      scheduledStart: true,
      endedAt: true,
      bus: { select: { id: true, busNumber: true, registrationNo: true, onboardCount: true } },
      route: {
        select: {
          id: true,
          code: true,
          routeStops: {
            orderBy: { stopOrder: "asc" },
            select: {
              stopOrder: true,
              scheduledHHMM: true,
              stop: { select: { id: true, name: true, lat: true, lng: true, address: true } },
            },
          },
        },
      },
      pickupRecords: {
        select: {
          id: true,
          stopId: true,
          status: true,
          pickedAt: true,
          student: {
            select: {
              enrollmentNo: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      },
    },
  });

  if (!trip) {
    return shell(
      <>
        <PageHeader title="Pickup checklist" icon="clipboard" />
        <EmptyState
          icon="alert"
          title="Trip not found"
          description="That trip no longer exists."
        />
      </>,
    );
  }

  const stops = trip.route.routeStops.map((rs) => rs.stop);
  const line = await getRouteGeometry(stops.map((s) => ({ lat: s.lat, lng: s.lng })));

  const rows: ChecklistRow[] = trip.pickupRecords.map((r) => ({
    recordId: r.id,
    studentName: r.student.user.name,
    enrollmentNo: r.student.enrollmentNo,
    phone: r.student.user.phone,
    status: r.status,
    pickedAt: r.pickedAt ? formatTime(r.pickedAt) : null,
    stopId: r.stopId,
  }));

  const picked = rows.filter((r) => r.status === "PICKED").length;
  const waiting = rows.filter((r) => r.status === "WAITING").length;
  const outstanding = rows.length - picked;

  const byStop = stops.map((stop, index) => ({
    stop,
    order: index + 1,
    scheduledHHMM: trip.route.routeStops[index]?.scheduledHHMM ?? null,
    rows: rows.filter((r) => r.stopId === stop.id),
  }));

  return (
    <PortalShell
      userName={session.role === Role.ADMIN ? "Admin" : "Driver"}
      roleLabel={session.role === Role.ADMIN ? "Admin" : "Driver"}
      nav={nav}
    >
      <PageHeader
        title={`${trip.bus.busNumber} · ${trip.route.code}`}
        description={`${trip.direction === "PICKUP" ? "Home → college" : "College → home"} · ${rows.length} students on this run`}
        icon="clipboard"
        action={<Badge tone={trip.status === "ONGOING" ? "emerald" : "slate"}>{trip.status}</Badge>}
      />

      {trips.length > 1 ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {trips.map((t) => (
            <Link
              key={t.id}
              href={`/driver/checklist?trip=${t.id}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                t.id === trip.id
                  ? "bg-brand-600 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {t.bus.busNumber} · {t.route.code} · {t.status.toLowerCase()}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="On board" value={picked} sub={`of ${rows.length} expected`} tone="emerald" icon="check" />
          <StatTile label="Waiting at stops" value={waiting} sub="marked by students" tone={waiting ? "amber" : "slate"} icon="users" />
          <StatTile label="Still to board" value={outstanding} sub="picked or missed" icon="clock" />
        </div>

        {trip.status === "SCHEDULED" ? (
          <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 inset-ring-1 inset-ring-blue-200">
            This trip has not started. Attendance can be recorded now, but the bus will only
            appear on a live map once it starts and the driver begins sharing a location.
          </div>
        ) : null}

        <RouteMap
          stops={trip.route.routeStops.map((rs, index) => ({
            id: rs.stop.id,
            name: rs.stop.name,
            lat: rs.stop.lat,
            lng: rs.stop.lng,
            order: index + 1,
            detail: rs.scheduledHHMM,
          }))}
          geometry={line?.line}
          height="18rem"
          interactive={false}
        />
        {line ? (
          <p className="-mt-3 text-xs text-slate-500">
            {formatDistance(line.meters)} by {line.source === "osrm" ? "road" : "straight line (estimated)"}.
          </p>
        ) : null}

        {byStop.map(({ stop, order, scheduledHHMM, rows: stopRows }) => (
          <Card key={stop.id}>
            <CardTitle
              icon="pin"
              hint={stop.address ?? undefined}
              action={
                <span className="flex items-center gap-2 text-xs">
                  {/*
                    `scheduledHHMM` is a wall-clock "HH:MM" string, not a Date.
                    Passing it to `formatTime` would make it midnight on the
                    local date and print a locale-formatted time that no longer
                    matched the schedule column, so it is rendered verbatim.
                  */}
                  {scheduledHHMM ? (
                    <span className="tabular-nums text-slate-500">{scheduledHHMM}</span>
                  ) : null}
                  {stopRows.filter((r) => r.status === "PICKED").length > 0 ? (
                    <Badge tone="emerald">
                      {stopRows.filter((r) => r.status === "PICKED").length}/{stopRows.length}
                    </Badge>
                  ) : null}
                </span>
              }
            >
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                  {order}
                </span>
                {stop.name}
              </span>
            </CardTitle>

            {stopRows.length === 0 ? (
              <p className="text-sm text-slate-500">Nobody is enrolled at this stop.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {stopRows.map((row) => (
                  <ChecklistRowView key={row.recordId} tripId={trip.id} row={row} />
                ))}
              </ul>
            )}
          </Card>
        ))}

        <p className="text-xs text-slate-500">
          Scheduled start {formatTime(trip.scheduledStart)}
          {trip.startedAt ? ` · started ${formatTime(trip.startedAt)}` : ""}
          {trip.endedAt ? ` · ended ${formatTime(trip.endedAt)}` : ""}
        </p>
      </div>
    </PortalShell>
  );
}
