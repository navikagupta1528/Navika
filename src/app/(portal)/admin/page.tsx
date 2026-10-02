import type { Metadata } from "next";
import Link from "next/link";
import { getAdminOverview } from "@/lib/queries";
import { ADMIN_NAV } from "./layout";
import { PageHeader } from "@/components/portal/portal-shell";
import {
  Badge,
  Card,
  CardTitle,
  StatTile,
  StatusDot,
} from "@/components/ui/primitives";
import { isStale, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

/** Blurbs for the quick links; the sidebar labels live in the layout. */
const SHORTCUTS: Record<string, string> = {
  "/admin/trips": "Schedule, run and review today's runs",
  "/admin/students": "Enrol students onto buses and stops",
  "/admin/stops": "Pickup points and map positions",
  "/admin/routes": "Routes, stop order and timings",
  "/admin/buses": "Fleet, capacity and route assignment",
  "/admin/drivers": "Driver records, licences and buses",
  "/admin/alerts": "Emergencies and breakdowns",
  "/admin/reports": "Attendance history and export",
};

export default async function AdminDashboard() {
  const overview = await getAdminOverview();
  const shortcuts = ADMIN_NAV.filter((n) => SHORTCUTS[n.href]);

  return (
    <>
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
              <Link href="/fleet" className="text-xs text-brand-700 underline">
                Open the live fleet map
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
            {shortcuts.map((section) => (
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
                <p className="mt-0.5 text-xs text-slate-500">
                  {SHORTCUTS[section.href]}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
