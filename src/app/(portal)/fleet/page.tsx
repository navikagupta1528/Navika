import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { getFleetPositions, getWatchableBusIds } from "@/lib/tracking-queries";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader } from "@/components/portal/portal-shell";
import { FleetMap } from "@/components/tracking/fleet-map";
import { Badge, EmptyState, StatTile } from "@/components/ui/primitives";
import { formatTime, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Live fleet" };

/**
 * Every bus that is currently reporting, on one map.
 *
 * The query is time-bounded in SQL, not filtered afterwards in the page, so this
 * screen can never render a bus that stopped moving two hours ago. That
 * distinction is the whole difference between a live map and a misleading one.
 */
export default async function FleetPage() {
  const session = await requireRole(Role.ADMIN, Role.PARENT, Role.STUDENT);
  const { asOf, buses } = await getFleetPositions();
  const watchable = await getWatchableBusIds(session.userId, session.role);
  // Only offer a "follow" link where the tracking page would actually open.
  const canFollow = (busId: string) => watchable === "all" || watchable.has(busId);

  const onTrip = buses.filter((b) => b.tripId !== null).length;
  const studentsOnBoard = buses.reduce((sum, b) => sum + b.onboardCount, 0);
  const simulated = buses.filter((b) => b.isSimulated).length;

  const nav = [
    { href: `/${session.role.toLowerCase()}`, label: "Dashboard", icon: "⌂" },
    { href: "/fleet", label: "Live fleet", icon: "📡" },
    { href: "/notifications", label: "Notifications", icon: "🔔" },
  ];

  return (
    <PortalShell
      userName={session.role === "ADMIN" ? "Transport office" : "Live fleet"}
      roleLabel="Live fleet"
      nav={nav}
    >
      <PageHeader
        title="Live fleet"
        description="Buses that reported a position in the last two minutes."
        action={
          <Badge tone={buses.length > 0 ? "emerald" : "slate"}>
            {buses.length} reporting
          </Badge>
        }
      />

      {buses.length === 0 ? (
        <EmptyState
          title="No buses are reporting right now"
          description="A bus appears here as soon as its driver starts sharing a location. If a trip is running and the bus is missing, the driver's phone has probably lost signal."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Buses reporting" value={buses.length} tone="emerald" />
            <StatTile
              label="On a running trip"
              value={onTrip}
              tone={onTrip > 0 ? "blue" : "slate"}
            />
            <StatTile label="Students on board" value={studentsOnBoard} />
          </div>

          {simulated > 0 ? (
            <p className="text-xs text-slate-500">
              {simulated} of these positions are simulated, not from a real
              phone. Tap one to open its route.
            </p>
          ) : null}

          <FleetMap
            serverNow={asOf}
            buses={buses.map((b) => ({
              id: b.busId,
              label: b.label,
              lat: b.lat,
              lng: b.lng,
              heading: b.heading,
              onboardCount: b.onboardCount,
              at: b.at.getTime(),
              routeName: b.routeName,
              tripDirection: b.direction,
              startedAt: b.startedAt?.getTime() ?? null,
              href: canFollow(b.busId) ? `/track/${b.busId}` : null,
            }))}
            height="30rem"
          />

          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Bus</th>
                  <th className="px-4 py-2 font-medium">Route</th>
                  <th className="px-4 py-2 font-medium">On board</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Last fix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {buses.map((b) => (
                  <tr key={b.busId}>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {b.label}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {b.registrationNo}
                      </span>
                      {b.isSimulated ? (
                        <Badge tone="violet" className="ml-2">
                          simulated
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{b.routeName ?? "—"}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-700">
                      {b.onboardCount}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-slate-600">
                      {b.startedAt ? formatTime(b.startedAt) : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {timeAgo(b.at)}
                      {canFollow(b.busId) ? (
                        <Link
                          href={`/track/${b.busId}`}
                          className="ml-2 text-xs text-brand-700 underline"
                        >
                          follow
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500">
            Positions shown are from {formatTime(new Date(asOf))}. This page does
            not refresh itself; open it again for the latest.
          </p>
        </div>
      )}
    </PortalShell>
  );
}
