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
import { formatTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Driver panel" };

export default async function DriverDashboard() {
  const session = await requireRole(Role.DRIVER);
  const user = await getCurrentUser();

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const trip = await prisma.trip.findFirst({
    where: {
      driverId: session.userId,
      date: { gte: start, lt: end },
      status: { in: ["ONGOING", "SCHEDULED"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      direction: true,
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
    },
  });

  const summary = trip ? await getTripPickupSummary(trip.id) : null;

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

      {!trip ? (
        <EmptyState
          title="No trip scheduled for today"
          description="When the admin schedules a run for you, the stop order and the student checklist appear here."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Bus"
              value={trip.bus.busNumber}
              sub={trip.bus.registrationNo}
              tone="blue"
            />
            <StatTile
              label="Route"
              value={trip.route.code}
              sub={trip.route.name}
            />
            <StatTile
              label="Waiting now"
              value={totalWaiting}
              sub="students marked as waiting"
              tone={totalWaiting > 0 ? "amber" : "slate"}
            />
            <StatTile
              label="Picked up"
              value={`${totalPicked}/${trip.bus.capacity}`}
              sub="seats vs capacity"
              tone="emerald"
            />
          </div>

          <Card>
            <CardTitle
              hint={
                trip.direction === "PICKUP"
                  ? "Morning run · home to college"
                  : "Evening run · college to home"
              }
              action={
                <Badge tone={trip.status === "ONGOING" ? "emerald" : "slate"}>
                  {trip.status}
                </Badge>
              }
            >
              Stops in order
            </CardTitle>

            <ol className="space-y-0">
              {trip.route.routeStops.map((rs, index) => {
                const bucket = summary?.byStop.get(rs.stop.id);
                const stopEvent = trip.status === "ONGOING" ? null : null;
                void stopEvent;

                return (
                  <li key={rs.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                        {index + 1}
                      </span>
                      {index < trip.route.routeStops.length - 1 ? (
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
              Today&apos;s schedule
            </CardTitle>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Scheduled start</dt>
                <dd className="font-medium text-slate-900">
                  {formatTime(trip.scheduledStart)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Started</dt>
                <dd className="font-medium text-slate-900">
                  {formatTime(trip.startedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Direction</dt>
                <dd className="font-medium text-slate-900">
                  {trip.direction === "PICKUP" ? "Home → college" : "College → home"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}
    </PortalShell>
  );
}
