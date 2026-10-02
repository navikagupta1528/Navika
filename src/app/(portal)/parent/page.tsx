import type { Metadata } from "next";
import Link from "next/link";
import { requireRole, getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { getStudentAssignment } from "@/lib/queries";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader } from "@/components/portal/portal-shell";
import { WaitingButton } from "@/components/tracking/waiting-button";
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

export const metadata: Metadata = { title: "My children" };

export default async function ParentDashboard() {
  await requireRole(Role.PARENT);
  const user = await getCurrentUser();
  const children = user?.parentProfile?.children ?? [];

  const today = new Date();
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

  const anyTracking = rows.some((row) => row.assignment);

  const nav = [
    { href: "/parent", label: "My children", icon: "👨‍👩‍👧", exact: true },
    ...(anyTracking ? [{ href: "/fleet", label: "All buses", icon: "📡" }] : []),
    { href: "/notifications", label: "Notifications", icon: "🔔" },
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
      />

      {rows.length === 0 ? (
        <EmptyState
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

          {rows.map((row) => (
            <Card key={row.student.id}>
              <CardTitle
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
                    />
                    <StatTile
                      label="Stop"
                      value={row.assignment.stop.name}
                      sub={row.assignment.stop.address}
                    />
                    <StatTile
                      label="Arriving in"
                      value={etaLabel(row.eta)}
                      sub={
                        row.distanceM !== null
                          ? `${(row.distanceM / 1000).toFixed(1)} km away`
                          : "no live location"
                      }
                      tone={row.isLive ? "emerald" : "slate"}
                    />
                    <StatTile
                      label="Bus status"
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
