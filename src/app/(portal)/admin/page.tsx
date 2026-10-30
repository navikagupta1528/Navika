import type { Metadata } from "next";
import Link from "next/link";
import { getAdminOverview } from "@/lib/queries";
import { ADMIN_NAV } from "./layout";
import { PageHeader } from "@/components/portal/portal-shell";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  IconBadge,
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
        eyebrow="Transport office"
        icon="overview"
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Buses"
            value={`${overview.activeBuses}/${overview.totalBuses}`}
            sub="active"
            tone="blue"
            icon="bus"
          />
          <StatTile
            label="Students"
            value={overview.totalStudents}
            tone="violet"
            icon="students"
          />
          <StatTile label="Drivers" value={overview.totalDrivers} icon="drivers" />
          <StatTile
            label="Open alerts"
            value={overview.openAlerts}
            sub="need attention"
            tone={overview.openAlerts > 0 ? "red" : "emerald"}
            icon="alerts"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Routes" value={overview.totalRoutes} icon="routes" />
          <StatTile label="Stops" value={overview.totalStops} icon="stops" />
          <StatTile label="Trips today" value={overview.tripsToday} icon="trips" />
          <StatTile
            label="On the road"
            value={overview.tripsOngoing}
            tone={overview.tripsOngoing > 0 ? "emerald" : "slate"}
            icon="navigate"
          />
        </div>

        <Card>
          <CardTitle
            icon="radio"
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
            <EmptyState
              icon="radio"
              title="No bus has reported a location yet"
              description="Live positions start appearing once a driver begins a trip with location sharing on."
            />
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
                className="busguard-linkcard group rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300"
              >
                {/* The tile carries `busguard-tile`, which lifts and tilts a few
                    degrees when the card is hovered or focused - see the
                    transition in globals.css. */}
                <span className="busguard-tile inline-flex">
                  <IconBadge name={section.icon} tone="brand" size="lg" />
                </span>
                <p className="mt-3 text-sm font-medium text-slate-900">
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
