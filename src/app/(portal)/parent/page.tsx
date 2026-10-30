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
import { ArrivalCountdown } from "@/components/tracking/arrival-countdown";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  StatTile,
  StatusDot,
} from "@/components/ui/primitives";
import { etaLabel, isStale, timeAgo, currentTimeMs } from "@/lib/utils";
import { haversineMeters, estimateEtaMinutes } from "@/lib/geo";

export const metadata: Metadata = { title: "My children" };

export default async function ParentDashboard() {
  await requireRole(Role.PARENT);
  const user = await getCurrentUser();
  const children = user?.parentProfile?.children ?? [];

  /**
   * One clock read for the whole render, taken through `currentTimeMs` because
   * the purity rule forbids `Date.now()` in a component body.
   *
   * Read once and threaded down rather than letting each countdown call the
   * clock itself: two reads on the same page are two instants, and a bus sitting
   * exactly on the freshness boundary would be live to one tile and stale to the
   * next. The same rule `getFleetPositions` follows.
   */
  const nowMs = currentTimeMs();

  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const rows = await Promise.all(
    children.map(async (link) => {
      const assignment = await getStudentAssignment(link.student.id);
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

      /**
       * Today's trip and this child's record on it.
       *
       * Needed because the parent is the one who usually has to physically put
       * their child on the bus in the morning, so it is the parent, not the
       * student, who needs to say "they are at the stop" from this account.
       */
      const trip = bus
        ? await prisma.trip.findFirst({
            where: { busId: bus.id, date: { gte: today, lt: tomorrow } },
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true },
          })
        : null;

      const record = trip
        ? await prisma.pickupRecord.findFirst({
            where: { tripId: trip.id, studentId: link.student.id },
            select: { id: true, status: true },
          })
        : null;

      return { student: link.student, assignment, bus, distanceM, eta, isLive, trip, record };
    }),
  );

  /**
   * Today's children the bus left behind, and have not yet been confirmed safe.
   *
   * Fetched once for the page rather than per child, and scoped to this
   * parent's own children by the same rule every other read here follows. It is
   * the one card that must be impossible to miss, so it sits above everything
   * else rather than inside a child's card where it could scroll out of view.
   */
  const missed = await getMissedPickupsToday(
    children.map((link) => link.student.id),
    { gte: today, lt: tomorrow },
  );

  const anyTracking = rows.some((row) => row.assignment);

  const nav: NavItem[] = [
    { href: "/parent", label: "My children", icon: "users", exact: true },
    ...(anyTracking
      ? ([{ href: "/fleet", label: "All buses", icon: "radio" }] satisfies NavItem[])
      : []),
    { href: "/notifications", label: "Notifications", icon: "bell" },
  ];

  return (
    <PortalShell
      userName={user?.name ?? "Parent"}
      roleLabel="Parent / Guardian"
      nav={nav}
    >
      <PageHeader
        title="My children"
        description="Follow the bus your child travels on."
        icon="users"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="users"
          title="No children linked yet"
          description="Ask the college office to register your child, then link their enrollment number from the registration page."
        />
      ) : (
        <div className="space-y-6">
          {/* One button for the whole page, not one per child: the alert is
              attached to a trip resolved from the caller's own enrolments, so
              a second button for a second child would be a control that
              silently picks the wrong bus. */}
          <EmergencyButton />

          {missed.length > 0 && (
            <div className="space-y-3">
              {missed.map((m) => (
                <SafeButton
                  key={m.id}
                  recordId={m.id}
                  studentName={m.student.user.name}
                  stopName={m.stop.name}
                  busLabel={m.trip.bus.busNumber}
                  perspective="guardian"
                />
              ))}
            </div>
          )}

          {rows.map((row) => (
            <Card key={row.student.id}>
              <CardTitle
                icon="graduation"
                hint={`${row.student.enrollmentNo}${row.student.department ? ` · ${row.student.department}` : ""}`}
                action={
                  row.assignment ? (
                    <Badge tone="emerald">
                      {row.assignment.direction === "PICKUP" ? "Morning" : "Evening"}
                    </Badge>
                  ) : null
                }
              >
                {row.student.user.name}
              </CardTitle>

              {!row.assignment ? (
                <p className="text-sm text-slate-500">
                  Not assigned to a bus yet.
                </p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile
                      label="Bus"
                      value={row.bus?.busNumber ?? "—"}
                      sub={row.bus?.registrationNo}
                      tone="blue"
                      icon="bus"
                    />
                    <StatTile
                      label="Stop"
                      value={row.assignment.stop.name}
                      sub={row.assignment.stop.address}
                      icon="pin"
                    />
                    <StatTile
                      label="Arriving in"
                      icon="clock"
                      value={
                        row.bus && row.assignment ? (
                          <ArrivalCountdown
                            variant="compact"
                            busId={row.bus.id}
                            stop={{
                              name: row.assignment.stop.name,
                              lat: row.assignment.stop.lat,
                              lng: row.assignment.stop.lng,
                            }}
                            initialEtaMinutes={row.eta}
                            serverNow={nowMs}
                            initialPosition={
                              row.bus.currentLat != null &&
                              row.bus.currentLng != null &&
                              row.bus.lastLocationAt != null
                                ? {
                                    lat: row.bus.currentLat,
                                    lng: row.bus.currentLng,
                                    at: row.bus.lastLocationAt.getTime(),
                                  }
                                : null
                            }
                          />
                        ) : (
                          etaLabel(row.eta)
                        )
                      }
                      sub={
                        row.distanceM !== null
                          ? `${(row.distanceM / 1000).toFixed(1)} km away`
                          : "no live location"
                      }
                      tone={row.isLive ? "emerald" : "slate"}
                    />
                    <StatTile
                      label="Bus status"
                      icon="signal"
                      value={
                        <StatusDot
                          online={row.isLive}
                          label={row.isLive ? "On route" : "Not reporting"}
                        />
                      }
                      sub={`Last seen ${timeAgo(row.bus?.lastLocationAt)}`}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <p className="mb-2 text-sm font-medium text-slate-800">
                        Waiting status
                      </p>
                      {row.record && row.trip ? (
                        <WaitingButton
                          tripId={row.trip.id}
                          initialStatus={row.record.status}
                          tripRunning={row.trip.status === "ONGOING"}
                        />
                      ) : (
                        <p className="text-sm text-slate-600">
                          Nothing to mark yet. The driver creates each child&apos;s
                          attendance record when the trip starts.
                        </p>
                      )}
                    </div>

                    <div className="flex items-end">
                      <Link
                        href={`/track/${row.assignment.bus.id}`}
                        className="btn-primary w-full text-sm"
                      >
                        Track {row.bus?.busNumber} live
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
