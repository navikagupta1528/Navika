import type { Metadata } from "next";
import { requireRole } from "@/lib/dal";
import { getCurrentUser } from "@/lib/dal";
import { getStudentAssignment, getTodayTrip } from "@/lib/queries";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader } from "@/components/portal/portal-shell";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  StatTile,
  StatusDot,
} from "@/components/ui/primitives";
import { etaLabel, isStale, timeAgo } from "@/lib/utils";
import { haversineMeters, estimateEtaMinutes } from "@/lib/geo";

export const metadata: Metadata = { title: "My bus" };

export default async function StudentDashboard() {
  await requireRole(Role.STUDENT);
  const user = await getCurrentUser();
  const profile = user?.studentProfile;

  const assignment = profile ? await getStudentAssignment(profile.id) : null;
  const trip =
    assignment && assignment.bus.routeId
      ? await getTodayTrip(assignment.bus.id, "PICKUP")
      : null;

  const bus = assignment?.bus;
  const distanceM =
    bus?.currentLat != null &&
    bus?.currentLng != null &&
    assignment?.stop
      ? haversineMeters(
          { lat: bus.currentLat, lng: bus.currentLng },
          { lat: assignment.stop.lat, lng: assignment.stop.lng },
        )
      : null;

  const eta =
    distanceM !== null && bus?.currentLat != null && bus?.currentLng != null
      ? estimateEtaMinutes(
          { lat: bus.currentLat, lng: bus.currentLng },
          { lat: assignment!.stop.lat, lng: assignment!.stop.lng },
        )
      : null;

  const isLive = !isStale(bus?.lastLocationAt);

  const nav = [
    { href: "/student", label: "My bus", icon: "🚌", exact: true },
    { href: "/student/route", label: "Route & stops", icon: "📍" },
  ];

  return (
    <PortalShell
      userName={user?.name ?? "Student"}
      roleLabel="Student"
      nav={nav}
    >
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "there"}`}
        description="Your bus, your stop, and when to step out."
      />

      {!assignment ? (
        <EmptyState
          title="You have not been assigned to a bus yet"
          description="Your college office assigns students to a bus and a pickup stop. Once that is done, live tracking and arrival estimates appear here."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Your bus"
              value={bus?.busNumber ?? "—"}
              sub={bus?.registrationNo}
              tone="blue"
            />
            <StatTile
              label="Your stop"
              value={assignment.stop.name}
              sub={assignment.stop.address}
            />
            <StatTile
              label="Arriving in"
              value={etaLabel(eta)}
              sub={
                distanceM !== null ? `${(distanceM / 1000).toFixed(1)} km away` : "no live location"
              }
              tone={isLive ? "emerald" : "slate"}
            />
            <StatTile
              label="Bus status"
              value={
                isLive ? (
                  <StatusDot online label="On route" />
                ) : (
                  <StatusDot online={false} label="Not reporting" />
                )
              }
              sub={`Last seen ${timeAgo(bus?.lastLocationAt)}`}
              tone={isLive ? "emerald" : "amber"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle hint="Where the driver starts the pickup run">
                Route
              </CardTitle>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {bus?.route?.name ?? "No route assigned"}
                  </p>
                  {bus?.route?.code ? (
                    <Badge tone="slate" className="mt-1">
                      {bus.route.code}
                    </Badge>
                  ) : null}
                </div>
                <Badge tone={trip?.status === "ONGOING" ? "emerald" : "slate"}>
                  {trip?.status === "ONGOING"
                    ? "Trip running"
                    : trip
                      ? `Trip ${trip.status.toLowerCase()}`
                      : "No trip today"}
                </Badge>
              </div>
            </Card>

            <Card>
              <CardTitle hint="You will be able to mark yourself as waiting from Phase 4">
                Waiting status
              </CardTitle>
              <p className="text-sm text-slate-600">
                Soon you can tap <span className="font-medium">I&apos;m waiting</span>{" "}
                when you leave home, and the driver sees the count for your stop
                immediately.
              </p>
            </Card>
          </div>

          {bus?.route ? (
            <Card>
              <CardTitle
                hint={`${bus.route.routeStops.length} stops · ${assignment.direction === "PICKUP" ? "morning run" : "evening run"}`}
              >
                Stops on this route
              </CardTitle>
              <ol className="space-y-0">
                {bus.route.routeStops.map((rs, index) => {
                  const isMine = rs.stop.id === assignment.stop.id;
                  return (
                    <li key={rs.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                            isMine
                              ? "bg-brand-600 text-white"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {index + 1}
                        </span>
                        {index < bus.route!.routeStops.length - 1 ? (
                          <span className="my-0.5 w-0.5 flex-1 bg-slate-200" />
                        ) : null}
                      </div>
                      <div className="flex-1 pb-4">
                        <p
                          className={`text-sm ${
                            isMine ? "font-semibold text-brand-800" : "text-slate-800"
                          }`}
                        >
                          {rs.stop.name}
                          {isMine ? " · your stop" : ""}
                        </p>
                        <p className="text-xs text-slate-500">
                          {rs.stop.address ?? "—"}
                          {rs.scheduledHHMM ? ` · ${rs.scheduledHHMM}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          ) : null}
        </div>
      )}
    </PortalShell>
  );
}
