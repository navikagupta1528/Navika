import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { Role } from "@/generated/prisma/enums";
import { getTrackingView } from "@/lib/tracking-queries";
import { PortalShell, PageHeader, type NavItem } from "@/components/portal/portal-shell";
import { LiveTrackingMap } from "@/components/tracking/live-tracking-map";
import { ArrivalCountdown } from "@/components/tracking/arrival-countdown";
import { Badge, Card, CardTitle, EmptyState, StatTile } from "@/components/ui/primitives";
import { formatDistance } from "@/lib/geo";
import { formatTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Live tracking" };

const DENIAL_COPY = {
  "no-bus": {
    title: "Bus not found",
    body: "This link points at a bus that does not exist, or the bus has been removed.",
  },
  "no-route": {
    title: "No route assigned",
    body: "This bus is not on a route yet, so there is nothing to draw. Ask the admin to assign one.",
  },
  "not-yours": {
    title: "You cannot watch this bus",
    body: "Live tracking is available for the bus you or your child are enrolled on.",
  },
  "no-stop": {
    title: "Your stop is no longer on this route",
    body: "Your enrolment points at a stop that is not part of this route any more. The admin needs to update it.",
  },
} as const;

export default async function TrackBusPage({
  params,
}: {
  params: Promise<{ busId: string }>;
}) {
  const session = await requireRole(Role.STUDENT, Role.PARENT, Role.ADMIN);
  const { busId } = await params;

  const result = await getTrackingView(
    session.userId,
    session.role,
    busId,
  );

  if ("denial" in result) {
    const copy = DENIAL_COPY[result.denial];
    return (
      <PortalShell
        userName={session.role === "ADMIN" ? "Admin" : "You"}
        roleLabel={session.role}
        nav={[
          {
            href: session.role === "ADMIN" ? "/admin" : session.role === "DRIVER" ? "/driver" : `/${session.role.toLowerCase()}`,
            label: "Back",
            icon: "arrowLeft",
          },
        ]}
      >
        <PageHeader title="Live tracking" icon="radio" />
        <EmptyState icon="alert" title={copy.title} description={copy.body} />
        <p className="mt-4 text-sm">
          <Link className="text-brand-700 underline" href="/">
            Go to your dashboard
          </Link>
        </p>
      </PortalShell>
    );
  }

  const { view, asOf } = result;

  const nav: NavItem[] = [
    {
      href: session.role === "ADMIN" ? "/admin" : `/${session.role.toLowerCase()}`,
      label: "Dashboard",
      icon: "overview",
    },
  ];

  return (
    <PortalShell userName="Live tracking" roleLabel={session.role} nav={nav}>
      <PageHeader
        title={`${view.bus.label} · ${view.bus.routeCode}`}
        description={view.bus.routeName}
        icon="radio"
        action={
          <Badge tone={view.positionAge === "fresh" ? "emerald" : "slate"}>
            {view.positionAge === "fresh"
              ? "bus is reporting"
              : view.positionAge === "stale"
                ? "last known position"
                : "not reporting"}
          </Badge>
        }
      />

      <div className="space-y-6">
        {/* The hero number, and the only one on this page that has to move as
            the bus does. Everything else is a snapshot that is still true a
            minute later; an ETA is not. */}
        <Card accent="brand">
          <CardTitle
            icon="clock"
            hint={
              view.viewerStop
                ? `Towards ${view.viewerStop.name}`
                : "Whole route — no single stop to count down to"
            }
          >
            {view.viewerStop ? "Arriving at your stop" : "Live arrival"}
          </CardTitle>
          <ArrivalCountdown
            busId={view.bus.id}
            stop={
              view.viewerStop
                ? {
                    name: view.viewerStop.name,
                    lat: view.viewerStop.lat,
                    lng: view.viewerStop.lng,
                  }
                : null
            }
            initialEtaMinutes={view.etaMinutes}
            serverNow={asOf}
            initialPosition={
              view.lastPosition
                ? {
                    lat: view.lastPosition.lat,
                    lng: view.lastPosition.lng,
                    at: view.lastPosition.at.getTime(),
                  }
                : null
            }
          />
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Your stop"
            value={view.viewerStop?.name ?? "whole route"}
            sub={view.bus.routeName}
            icon="pin"
          />
          <StatTile
            label="Students on board"
            value={view.bus.onboardCount}
            sub={view.bus.registrationNo}
            icon="users"
          />
          <StatTile
            label="Trip"
            value={view.trip ? view.trip.status.replace("_", " ").toLowerCase() : "not running"}
            sub={
              view.trip?.startedAt
                ? `started ${formatTime(view.trip.startedAt)}`
                : view.trip
                  ? "waiting to depart"
                  : "no trip scheduled today"
            }
            tone={view.trip?.status === "ONGOING" ? "blue" : "slate"}
            icon="navigate"
          />
        </div>

        <LiveTrackingMap
          serverNow={asOf}
          busId={view.bus.id}
          busLabel={view.bus.label}
          watchLabel={view.viewerStop?.name ?? null}
          watchStop={
            view.viewerStop
              ? { lat: view.viewerStop.lat, lng: view.viewerStop.lng }
              : null
          }
          pulseAt={
            view.viewerStop
              ? { lat: view.viewerStop.lat, lng: view.viewerStop.lng }
              : null
          }
          etaMinutes={view.etaMinutes}
          stops={view.stops.map((s) => ({
            id: s.id,
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            order: s.order,
            isActive: true,
            detail: s.visited
              ? "visited"
              : s.isViewerStop
                ? "your stop"
                : s.order === 1
                  ? "route start"
                  : null,
          }))}
          geometry={view.geometry}
          initialPosition={
            view.lastPosition
              ? {
                  lat: view.lastPosition.lat,
                  lng: view.lastPosition.lng,
                  at: view.lastPosition.at.getTime(),
                }
              : null
          }
        />

        {view.viewerStop ? (
          <Card>
            <CardTitle icon="pin" hint="Stops already served are marked.">Route progress</CardTitle>
            <ol className="space-y-1.5">
              {view.stops.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                        s.visited
                          ? "bg-emerald-100 text-emerald-700"
                          : s.isViewerStop
                            ? "bg-brand-100 text-brand-800"
                            : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {s.order}
                    </span>
                    <span className={s.visited ? "text-slate-500 line-through" : "text-slate-800"}>
                      {s.name}
                    </span>
                  </span>
                  {s.isViewerStop ? <Badge tone="blue">your stop</Badge> : null}
                </li>
              ))}
            </ol>
            {view.distanceMeters !== null ? (
              <p className="mt-3 text-xs text-slate-500">
                Route length {formatDistance(view.distanceMeters)} end to end.
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>
    </PortalShell>
  );
}
