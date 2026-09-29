import type { Metadata } from "next";
import Link from "next/link";
import { requireRole, getCurrentUser } from "@/lib/dal";
import { getAdminOverview } from "@/lib/queries";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader } from "@/components/portal/portal-shell";
import {
  Badge,
  Card,
  CardTitle,
  StatTile,
  StatusDot,
} from "@/components/ui/primitives";
import { isStale, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

const SECTIONS = [
  { href: "/admin/buses", label: "Buses", icon: "🚌", blurb: "Fleet, capacity and assignment" },
  { href: "/admin/routes", label: "Routes", icon: "🗺️", blurb: "Routes and stop order" },
  { href: "/admin/stops", label: "Stops", icon: "📍", blurb: "Pickup points and map positions" },
  { href: "/admin/students", label: "Students", icon: "🎓", blurb: "Enrollments and bus allocation" },
  { href: "/admin/drivers", label: "Drivers", icon: "🧑‍✈️", blurb: "Driver records and licences" },
  { href: "/admin/live", label: "Live map", icon: "📡", blurb: "All buses, live (Phase 3)" },
  { href: "/admin/reports", label: "Reports", icon: "📊", blurb: "Attendance export (Phase 5)" },
];

export default async function AdminDashboard() {
  await requireRole(Role.ADMIN);
  const user = await getCurrentUser();
  const overview = await getAdminOverview();

  const nav = [
    { href: "/admin", label: "Overview", icon: "📊", exact: true },
    ...SECTIONS.map((s) => ({ href: s.href, label: s.label, icon: s.icon })),
  ];

  return (
    <PortalShell
      userName={user?.name ?? "Admin"}
      roleLabel="Administrator"
      nav={nav}
    >
      <PageHeader
        title="Transport overview"
        description="Everything happening across the fleet right now."
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Buses"
            value={`${overview.activeBuses}/${overview.totalBuses}`}
            sub="active"
            tone="blue"
          />
          <StatTile label="Students" value={overview.totalStudents} tone="violet" />
          <StatTile label="Drivers" value={overview.totalDrivers} />
          <StatTile
            label="Open alerts"
            value={overview.openAlerts}
            sub="need attention"
            tone={overview.openAlerts > 0 ? "red" : "emerald"}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Routes" value={overview.totalRoutes} />
          <StatTile label="Stops" value={overview.totalStops} />
          <StatTile label="Trips today" value={overview.tripsToday} />
          <StatTile
            label="On the road"
            value={overview.tripsOngoing}
            tone={overview.tripsOngoing > 0 ? "emerald" : "slate"}
          />
        </div>

        <Card>
          <CardTitle
            hint="Buses that have reported a position recently"
            action={
              <Link href="/admin/live" className="text-xs font-medium text-brand-700 hover:underline">
                Open live map
              </Link>
            }
          >
            Fleet positions
          </CardTitle>

          {overview.liveBuses.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              No bus has reported a location yet. Live positions start appearing
              once a driver begins a trip with location sharing on.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4 font-medium">Bus</th>
                    <th className="pb-2 pr-4 font-medium">Route</th>
                    <th className="pb-2 pr-4 font-medium">Onboard</th>
                    <th className="pb-2 pr-4 font-medium">Speed</th>
                    <th className="pb-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.liveBuses.map((bus) => {
                    const stale = isStale(bus.lastLocationAt);
                    return (
                      <tr key={bus.id}>
                        <td className="py-2.5 pr-4">
                          <span className="font-medium text-slate-900">
                            {bus.busNumber}
                          </span>
                          {bus.isSimulated ? (
                            <Badge tone="violet" className="ml-2">
                              simulated
                            </Badge>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">
                          {bus.route?.name ?? "—"}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums text-slate-600">
                          {bus.onboardCount}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums text-slate-600">
                          {bus.speedKph != null ? `${bus.speedKph.toFixed(0)} km/h` : "—"}
                        </td>
                        <td className="py-2.5">
                          <StatusDot
                            online={!stale}
                            label={timeAgo(bus.lastLocationAt)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Manage</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
              >
                <span aria-hidden className="text-xl">
                  {section.icon}
                </span>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {section.label}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{section.blurb}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
