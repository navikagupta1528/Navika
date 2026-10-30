import type { Metadata } from "next";
import Link from "next/link";
import { requireRole, getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { getStudentAssignment, getMissedPickupsToday } from "@/lib/queries";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader, type NavItem } from "@/components/portal/portal-shell";
import { WaitingButton } from "@/components/tracking/waiting-button";
import { SafeButton } from "@/components/tracking/safe-button";
import { EmergencyButton } from "@/components/tracking/emergency-button";
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

  /**
   * The student's own record on today's trip.
   *
   * Looked up through the enrolment rather than the trip, because the student
   * may have several enrolments (morning and evening) and only the one matching
   * today's running direction is the one they can be "waiting" for.
   */
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const liveTrip = assignment
    ? await prisma.trip.findFirst({
        where: { busId: assignment.bus.id, date: { gte: today, lt: tomorrow } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, direction: true },
      })
    : null;

  const myRecord =
    liveTrip && profile
      ? await prisma.pickupRecord.findFirst({
          where: { tripId: liveTrip.id, studentId: profile.id },
          select: { id: true, status: true },
        })
      : null;

  /**
   * A stop the bus has already left without them, not yet confirmed safe.
   *
   * Scoped to the student themself by passing their own profile id — the same
   * rule the waiting button follows. Shown above everything else, because a
   * student who has been left behind is the one case where the page must not
   * wait to be scrolled to.
   */
  const missed = profile
    ? await getMissedPickupsToday([profile.id], { gte: today, lt: tomorrow })
    : [];

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

  const nav: NavItem[] = [
    { href: "/student", label: "My bus", icon: "bus", exact: true },
    ...(assignment
      ? ([{ href: `/track/${assignment.bus.id}`, label: "Live tracking", icon: "radio" }] satisfies NavItem[])
      : []),
    { href: "/notifications", label: "Notifications", icon: "bell" },
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
        action={
          assignment ? (
            <Link href={`/track/${assignment.bus.id}`} className="btn-primary text-sm">
              Track my bus live
            </Link>
          ) : null
        }
      />

      {missed.length > 0 && (
        <div className="space-y-3">
          {missed.map((m) => (
            <SafeButton
              key={m.id}
              recordId={m.id}
              studentName={user?.name ?? "You"}
              stopName={m.stop.name}
              busLabel={m.trip.bus.busNumber}
              perspective="student"
            />
          ))}
        </div>
      )}      {!assignment ? (
        <EmptyState
          icon="bus"
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
              icon="bus"
            />
            <StatTile
              label="Your stop"
              value={assignment.stop.name}
              sub={assignment.stop.address}
              icon="pin"
            />
            <StatTile
              label="Arriving in"
              icon="clock"
              value={etaLabel(eta)}
              sub={
                distanceM !== null ? `${(distanceM / 1000).toFixed(1)} km away` : "no live location"
              }
              tone={isLive ? "emerald" : "slate"}
            />
            <StatTile
              label="Bus status"
              icon="signal"
              value={
                isLive ? (
                  <StatusDot online label="Live" />
                ) : (
                  <StatusDot online={false} label="Not live" />
                )
              }
              sub={isLive ? `Last seen ${timeAgo(bus?.lastLocationAt)}` : liveTrip?.status === "SCHEDULED" ? "Trip scheduled — waiting for driver" : liveTrip?.status === "ONGOING" ? "Trip running — waiting for location" : "No trip today"}
              tone={isLive ? "emerald" : liveTrip?.status === "ONGOING" ? "amber" : "slate"}
            />
          </div>

          <EmergencyButton busNumber={bus?.busNumber ?? null} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle icon="routes" hint="Where the driver starts the pickup run">
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
                <Badge tone={liveTrip?.status === "ONGOING" ? "emerald" : "slate"}>
                  {liveTrip?.status === "ONGOING"
                    ? "Trip running"
                    : liveTrip
                      ? `Trip ${liveTrip.status.toLowerCase()}`
                      : "No trip today"}
                </Badge>
              </div>
            </Card>

            <Card>
              <CardTitle icon="clock" hint="Tells the driver to expect you">
                Waiting status
              </CardTitle>
              {myRecord ? (
                <WaitingButton
                  tripId={liveTrip!.id}
                  initialStatus={myRecord.status}
                  tripRunning={liveTrip!.status === "ONGOING"}
                />
              ) : (
                <p className="text-sm text-slate-600">
                  There is no attendance record for you on today&apos;s trip yet.
                  The admin creates these when the trip starts.
                </p>
              )}
            </Card>
          </div>

          {bus?.route ? (
            <Card>
              <CardTitle
                icon="pin"
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
