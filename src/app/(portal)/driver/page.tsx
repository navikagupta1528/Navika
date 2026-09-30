import type { Metadata } from "next";
import { requireRole, getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { getTripPickupSummary } from "@/lib/queries";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader } from "@/components/portal/portal-shell";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  StatTile,
} from "@/components/ui/primitives";
import { formatDate, formatTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Driver panel" };

export default async function DriverDashboard() {
  const session = await requireRole(Role.DRIVER);
  const user = await getCurrentUser();

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const tripSelect = {
    id: true,
    status: true,
    direction: true,
    date: true,
    startedAt: true,
    scheduledStart: true,
    bus: {
      select: {
        id: true,
        busNumber: true,
        registrationNo: true,
        capacity: true,
        onboardCount: true,
        lastLocationAt: true,
      },
    },
    route: {
      select: {
        id: true,
        name: true,
        code: true,
        routeStops: {
          orderBy: { stopOrder: "asc" },
          select: {
            id: true,
            stopOrder: true,
            scheduledHHMM: true,
            stop: { select: { id: true, name: true, address: true, lat: true, lng: true } },
          },
        },
      },
    },
  } as const;

  const trip = await prisma.trip.findFirst({
    where: {
      driverId: session.userId,
      date: { gte: start, lt: end },
      status: { in: ["ONGOING", "SCHEDULED"] },
    },
    orderBy: { createdAt: "desc" },
    select: tripSelect,
  });

  /**
   * What to show when this driver has nothing booked for today.
   *
   * A blank screen is the wrong answer for someone who has opened the app on
   * their day off, or before the admin has published tomorrow's roster: the
   * route and stop list are the same either way, and the only thing that
   * changes is the heading. Two separate lookups rather than one with an `OR`,
   * because "the next trip" and "the most recent trip" are opposite sort
   * directions and an `OR` cannot rank them.
   */
  const [nextTrip, lastTrip] = trip
    ? [null, null]
    : await Promise.all([
        prisma.trip.findFirst({
          where: {
            driverId: session.userId,
            date: { gte: end },
            status: { in: ["SCHEDULED", "ONGOING"] },
          },
          orderBy: [{ date: "asc" }, { scheduledStart: "asc" }],
          select: tripSelect,
        }),
        prisma.trip.findFirst({
          where: { driverId: session.userId, status: "COMPLETED" },
          orderBy: [{ date: "desc" }, { endedAt: "desc" }],
          select: tripSelect,
        }),
      ]);

  const shown = trip ?? nextTrip ?? lastTrip;
  const isFallback = !trip && shown !== null;

  const summary = shown ? await getTripPickupSummary(shown.id) : null;

  const totalWaiting = summary
    ? [...summary.byStop.values()].reduce((acc, b) => acc + b.waiting.length, 0)
    : 0;
  const totalPicked = summary
    ? [...summary.byStop.values()].reduce((acc, b) => acc + b.picked.length, 0)
    : 0;

  const nav = [
    { href: "/driver", label: "Today's trip", icon: "🧭", exact: true },
    { href: "/driver/checklist", label: "Pickup checklist", icon: "☑️" },
  ];

  return (
    <PortalShell
      userName={user?.name ?? "Driver"}
      roleLabel="Driver"
      nav={nav}
      gpsState={
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          Location sharing turns on when you start a trip. Available in
          Phase&nbsp;3.
        </p>
      }
    >
      <PageHeader
        title="Driver panel"
        description="Your route for today, with the students waiting at each stop."
      />

      {isFallback && shown ? (
        <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 inset-ring-1 inset-ring-blue-200">
          <p className="font-medium">
            {nextTrip
              ? `Nothing is booked for you today. Showing your next run, on ${formatDate(shown.date)}.`
              : `Nothing is booked for you today. Showing the last trip you ran, on ${formatDate(shown.date)}.`}
          </p>
          <p className="mt-0.5 text-xs">
            The route and stop order below are the ones to expect. Attendance cannot be
            marked on a trip that is not today&apos;s.
          </p>
        </div>
      ) : null}

      {!shown ? (
        <EmptyState
          title="No trip scheduled"
          description="When the admin schedules a run for you, the stop order and the student checklist appear here."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Bus"
              value={shown.bus.busNumber}
              sub={shown.bus.registrationNo}
              tone="blue"
            />
            <StatTile
              label="Route"
              value={shown.route.code}
              sub={shown.route.name}
            />
            <StatTile
              label="Waiting now"
              value={totalWaiting}
              sub="students marked as waiting"
              tone={totalWaiting > 0 ? "amber" : "slate"}
            />
            <StatTile
              label="Picked up"
              value={`${totalPicked}/${shown.bus.capacity}`}
              sub="seats vs capacity"
              tone="emerald"
            />
          </div>

          <Card>
            <CardTitle
              hint={
                shown.direction === "PICKUP"
                  ? "Morning run · home to college"
                  : "Evening run · college to home"
              }
              action={
                <Badge tone={shown.status === "ONGOING" ? "emerald" : "slate"}>
                  {shown.status}
                </Badge>
              }
            >
              Stops in order
            </CardTitle>

            <ol className="space-y-0">
              {shown.route.routeStops.map((rs, index) => {
                const bucket = summary?.byStop.get(rs.stop.id);

                return (
                  <li key={rs.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                        {index + 1}
                      </span>
                      {index < shown.route.routeStops.length - 1 ? (
                        <span className="my-0.5 w-0.5 flex-1 bg-slate-200" />
                      ) : null}
                    </div>

                    <div className="flex-1 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          {rs.stop.name}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {rs.scheduledHHMM ? (
                            <span className="text-xs tabular-nums text-slate-500">
                              {rs.scheduledHHMM}
                            </span>
                          ) : null}
                          {bucket && bucket.waiting.length > 0 ? (
                            <Badge tone="amber">
                              {bucket.waiting.length} waiting
                            </Badge>
                          ) : null}
                          {bucket && bucket.picked.length > 0 ? (
                            <Badge tone="emerald">
                              {bucket.picked.length} picked
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        {rs.stop.address ?? "—"}
                      </p>
                      {bucket && bucket.waiting.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-600">
                          {bucket.waiting
                            .map(
                              (r) => r.student.user.name.split(" ")[0],
                            )
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card>
            <CardTitle hint="You will be able to tap each student to mark them picked up from Phase 4">
              {isFallback ? "Trip schedule" : "Today’s schedule"}
            </CardTitle>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Date</dt>
                <dd className="font-medium text-slate-900">{formatDate(shown.date)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Scheduled start</dt>
                <dd className="font-medium text-slate-900">
                  {formatTime(shown.scheduledStart)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Started</dt>
                <dd className="font-medium text-slate-900">
                  {formatTime(shown.startedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Direction</dt>
                <dd className="font-medium text-slate-900">
                  {shown.direction === "PICKUP" ? "Home → college" : "College → home"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}
    </PortalShell>
  );
}
