import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getRoute, listStopsNotOnRoute } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, EmptyState } from "@/components/ui/primitives";
import { EntityForm } from "@/components/admin/entity-form";
import { ActionForm } from "@/components/admin/action-form";
import { DetailList } from "@/components/admin/data-table";
import { routeDefaults } from "@/lib/admin/form-defs";
import {
  saveRoute,
  addRouteStop,
  moveRouteStop,
  removeRouteStop,
  updateRouteStop,
  toggleRouteActive,
  deleteRoute,
} from "@/app/actions/admin/routes";
import { formatTime } from "@/lib/utils";
import { getRouteGeometry } from "@/lib/osrm";
import { RouteMapEditor } from "@/components/admin/route-map-editor";

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { id } = await params;
  const [route, available] = await Promise.all([
    getRoute(id),
    listStopsNotOnRoute(id),
  ]);
  if (!route) notFound();

  const enrolledByStop = new Map<string, number>();
  for (const rs of route.routeStops) {
    enrolledByStop.set(rs.id, rs.stop._count.enrollments);
  }

  const routeDeletable = route._count.buses === 0 && route._count.trips === 0;

  /**
   * Road-following geometry for the map.
   *
   * Fetched here rather than in the browser so the result is cached in
   * `EtaCache` and shared by every visit to this route, and so the component
   * receives plain coordinates. `getRouteGeometry` already degrades to
   * straight-line points when OSRM is unreachable, so the map always draws
   * something; the flag alongside it is what tells the admin which one they are
   * looking at.
   */
  const road =
    route.routeStops.length >= 2
      ? await getRouteGeometry(
          route.routeStops.map((rs) => ({ lat: rs.stop.lat, lng: rs.stop.lng })),
        )
      : null;

  return (
    <>
      <PageHeader
        title={route.name}
        description={route.description ?? `Route ${route.code}`}
        action={
          <Link href="/admin/routes" className="btn-secondary">
            Back to routes
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {route.routeStops.length > 0 ? (
            <Card>
              <CardTitle hint="Drag a numbered marker to move that stop in the sequence.">
                Route map
              </CardTitle>
              <RouteMapEditor
                routeId={route.id}
                routeCode={route.code}
                stops={route.routeStops.map((rs) => ({
                  routeStopId: rs.id,
                  stopId: rs.stop.id,
                  name: rs.stop.name,
                  address: rs.stop.address,
                  lat: rs.stop.lat,
                  lng: rs.stop.lng,
                  stopOrder: rs.stopOrder,
                  scheduledHHMM: rs.scheduledHHMM,
                  isActive: rs.stop.isActive,
                  enrolled: rs.stop._count.enrollments,
                }))}
                geometry={road?.line}
                roadDistanceMeters={road?.meters ?? null}
                geometryIsEstimated={road?.source !== "osrm"}
              />
            </Card>
          ) : null}

          <Card>
            <CardTitle hint="The order here is the order the bus visits them.">
              Stop sequence
            </CardTitle>

            {route.routeStops.length === 0 ? (
              <EmptyState
                title="No stops on this route"
                description="Add stops below. Until there is at least one, buses on this route cannot run a trip."
              />
            ) : (
              <ol className="space-y-3">
                {route.routeStops.map((rs) => (
                  <li
                    key={rs.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                      {rs.stopOrder}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        {rs.stop.name}
                        {!rs.stop.isActive ? (
                          <Badge tone="slate">stop inactive</Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {rs.stop.address ?? "No address"}
                        {enrolledByStop.get(rs.id)
                          ? ` · ${enrolledByStop.get(rs.id)} student(s) enrolled`
                          : " · no students yet"}
                      </p>
                    </div>

                    {/* Inline time + position editor, saved on submit. */}
                    <form action={updateRouteStop} className="flex items-center gap-2">
                      <input type="hidden" name="routeId" value={route.id} />
                      <input type="hidden" name="id" value={rs.id} />
                      <label className="sr-only" htmlFor={`order-${rs.id}`}>
                        Position
                      </label>
                      <input
                        id={`order-${rs.id}`}
                        name="stopOrder"
                        type="number"
                        min={1}
                        defaultValue={rs.stopOrder}
                        className="field w-20 py-1 text-xs"
                      />
                      <label className="sr-only" htmlFor={`time-${rs.id}`}>
                        Scheduled time
                      </label>
                      <input
                        id={`time-${rs.id}`}
                        name="scheduledHHMM"
                        type="time"
                        defaultValue={rs.scheduledHHMM ?? ""}
                        className="field w-32 py-1 text-xs"
                      />
                      <button type="submit" className="btn-secondary px-3 py-1 text-xs">
                        Save
                      </button>
                    </form>

                    <div className="flex items-center gap-1">
                      <ActionForm
                        action={moveRouteStop}
                        hidden={{ routeId: route.id, id: rs.id, direction: "up" }}
                        label="↑"
                        className="btn-ghost px-2 py-1 text-xs"
                        title="Move earlier"
                        ariaLabel={`Move ${rs.stop.name} earlier`}
                      />
                      <ActionForm
                        action={moveRouteStop}
                        hidden={{ routeId: route.id, id: rs.id, direction: "down" }}
                        label="↓"
                        className="btn-ghost px-2 py-1 text-xs"
                        title="Move later"
                        ariaLabel={`Move ${rs.stop.name} later`}
                      />
                      <ActionForm
                        action={removeRouteStop}
                        hidden={{ routeId: route.id, id: rs.id }}
                        label="Remove"
                        className="btn-ghost px-2 py-1 text-xs text-red-600"
                        confirm={`Remove ${rs.stop.name} from this route?`}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {available.length > 0 ? (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <EntityForm
                  fields={[
                    {
                      kind: "select",
                      name: "stopId",
                      label: "Stop",
                      required: true,
                      options: available.map((s) => ({
                        value: s.id,
                        label: s.isActive ? s.name : `${s.name} (inactive)`,
                      })),
                    },
                    {
                      kind: "number",
                      name: "stopOrder",
                      label: "Position",
                      required: true,
                      min: 1,
                      defaultValue: String(route.routeStops.length + 1),
                    },
                    {
                      kind: "time",
                      name: "scheduledHHMM",
                      label: "Scheduled time",
                      help: "Shown to parents as the usual time.",
                    },
                  ]}
                  action={addRouteStop}
                  submitLabel="Add to route"
                  hidden={{ routeId: route.id }}
                  columns={3}
                />
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                Every active stop is already on this route.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Route details</CardTitle>
            <EntityForm
              fields={routeDefaults(route)}
              action={saveRoute}
              submitLabel="Save route"
              hidden={{ id: route.id }}
              cancelHref="/admin/routes"
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Summary</CardTitle>
            <DetailList
              items={[
                { label: "Code", value: <span className="font-mono">{route.code}</span> },
                {
                  label: "Status",
                  value: route.isActive ? (
                    <Badge tone="emerald">active</Badge>
                  ) : (
                    <Badge tone="slate">inactive</Badge>
                  ),
                },
                { label: "Stops", value: route.routeStops.length },
                { label: "Buses", value: route.buses.length },
              ]}
            />
          </Card>

          <Card>
            <CardTitle hint="Buses currently serving this route">Fleet</CardTitle>
            {route.buses.length === 0 ? (
              <p className="text-sm text-slate-500">
                No buses assigned. Assign one on the Fleet screen.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {route.buses.map((bus) => (
                  <li key={bus.id}>
                    <Link
                      href={`/admin/buses/${bus.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {bus.busNumber}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500">
                      {bus.registrationNo}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Status</CardTitle>
            <ActionForm
              action={toggleRouteActive}
              hidden={{ id: route.id, next: String(!route.isActive) }}
              label={route.isActive ? "Deactivate route" : "Reactivate route"}
              className="btn-secondary w-full"
            />
            {route.routeStops.length > 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                First stop is due around {formatTime(route.routeStops[0]?.scheduledHHMM ?? null)}{" "}
                if a time is set.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Danger zone</CardTitle>
            {routeDeletable ? (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  No bus and no trip reference this route, so it can be removed along
                  with its {route.routeStops.length} stop link(s).
                </p>
                <ActionForm
                  action={deleteRoute}
                  hidden={{ id: route.id }}
                  label="Delete route permanently"
                  className="btn-danger w-full"
                  confirm={`Delete route "${route.name}" and its stop sequence? This cannot be undone.`}
                />
              </>
            ) : (
              <p className="text-xs text-slate-500">
                Delete is unavailable while this route is in use
                {[
                  route._count.buses > 0 ? `${route._count.buses} bus(es) assigned` : null,
                  route._count.trips > 0 ? `${route._count.trips} trip(s) run` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                . Detach the buses and deactivate the route instead — that keeps every
                past trip readable.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
