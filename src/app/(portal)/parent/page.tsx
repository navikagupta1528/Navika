import type { Metadata } from "next";
import { requireRole, getCurrentUser } from "@/lib/dal";
import { getStudentAssignment } from "@/lib/queries";
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

export const metadata: Metadata = { title: "My children" };

export default async function ParentDashboard() {
  await requireRole(Role.PARENT);
  const user = await getCurrentUser();
  const children = user?.parentProfile?.children ?? [];

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

      return { student: link.student, assignment, bus, distanceM, eta, isLive };
    }),
  );

  const nav = [
    { href: "/parent", label: "My children", icon: "👨‍👩‍👧", exact: true },
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
              )}
            </Card>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
