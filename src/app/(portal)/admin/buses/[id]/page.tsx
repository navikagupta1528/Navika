import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getBus, getBusLoads, listRoutes, listDrivers } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, EmptyState } from "@/components/ui/primitives";
import { DetailList } from "@/components/admin/data-table";
import { EntityForm, QuickForm } from "@/components/admin/entity-form";
import { ActionForm } from "@/components/admin/action-form";
import { SimulationToggle } from "@/components/admin/simulation-toggle";
import { isSimulating, simulationProgress } from "@/server/simulator-runner";
import { busDefaults, busStatusOptions } from "@/lib/admin/form-defs";
import { saveBus, assignBusDriver, unassignBusDriver, setBusStatus, deleteBus } from "@/app/actions/admin/buses";
import { formatDate } from "@/lib/utils";

const STATUS_TONE = {
  ACTIVE: "emerald",
  MAINTENANCE: "amber",
  INACTIVE: "slate",
} as const;

export default async function BusDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { id } = await params;
  const [bus, loads, routes, drivers] = await Promise.all([
    getBus(id),
    getBusLoads(),
    listRoutes(),
    listDrivers(),
  ]);
  if (!bus) notFound();

  const load = loads.find((l) => l.id === bus.id);
  const active = bus.busAssignments.filter((a) => a.validTo == null);
  const past = bus.busAssignments.filter((a) => a.validTo != null);

  const busDeletable = bus._count.trips === 0 && bus._count.enrollments === 0;

  const progress = simulationProgress(bus.id);

  const fields = busDefaults(bus).map((f) =>
    f.name === "routeId"
      ? {
          ...f,
          kind: "select" as const,
          options: routes
            .filter((r) => r.isActive)
            .map((r) => ({ value: r.id, label: `${r.name} (${r.code})` })),
          defaultValue: bus.routeId ?? "",
        }
      : f,
  );

  const assignableDrivers = drivers.filter(
    (d) => d.isActive && d.profile && !active.some((a) => a.driver.id === d.id),
  );

  return (
    <>
      <PageHeader
        title={`Bus ${bus.busNumber}`}
        description={`${bus.registrationNo}${bus.model ? ` · ${bus.model}` : ""}`}
        action={
          <Link href="/admin/buses" className="btn-secondary">
            Back to fleet
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Bus details</CardTitle>
            <EntityForm
              fields={fields}
              action={saveBus}
              submitLabel="Save bus"
              hidden={{ id: bus.id, status: bus.status }}
              cancelHref="/admin/buses"
            />

            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="label">Status</p>
              <div className="flex flex-wrap gap-2">
                {busStatusOptions.map((o) => (
                  <ActionForm
                    key={o.value}
                    action={setBusStatus}
                    hidden={{ id: bus.id, status: o.value }}
                    label={o.label}
                    className={
                      bus.status === o.value ? "btn-primary text-xs" : "btn-secondary text-xs"
                    }
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                A bus must be <strong>active</strong> to have trips scheduled. Maintenance keeps
                its history and students but takes it off the road.
              </p>
            </div>

            {/*
              Route simulation, in its own block rather than bolted onto the
              status form. It is a different kind of action - it starts a process
              rather than setting a column - and mixing the two would suggest that
              taking a bus into maintenance also stops it moving.
            */}
            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="label">Demo mode</p>
              <SimulationToggle
                busId={bus.id}
                running={isSimulating(bus.id)}
                hasRoute={(bus.route?._count.routeStops ?? 0) >= 2}
              />
              {/*
                A live readout, read at render time. It is only ever rendered on a
                page load rather than ticking, which is enough here - the map is
                where you watch the bus move, and this line exists to answer "is it
                actually driving, or is the badge lying again".
              */}
              {progress && progress.totalMeters > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  {Math.round((progress.alongMeters / progress.totalMeters) * 100)}% along the
                  route, heading {progress.leg}.
                </p>
              ) : null}
              <p className="mt-2 text-xs text-slate-500">
                {bus.isSimulated && !isSimulating(bus.id) ? (
                  <>
                    This bus is still flagged as simulated from a previous run. That
                    flag is stored, but the movement lives in the server process and
                    did not survive a restart - press Simulate to drive it again.
                  </>
                ) : (
                  <>
                    Drives the bus along{" "}
                    {bus.route ? bus.route.name : "its route"} with no driver, so
                    live tracking and the parent screens can be demonstrated without
                    a vehicle on the road. Positions are broadcast to the map but
                    are not part of any trip.
                  </>
                )}
              </p>
            </div>
          </Card>

          <Card>
            <CardTitle hint="Who is allowed to drive this bus right now.">
              Drivers on this bus
            </CardTitle>

            {active.length === 0 ? (
              <EmptyState
                title="No driver assigned"
                description="Assign a driver below. Trips need a driver, so nothing can be scheduled until then."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {active.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="flex items-center gap-2 font-medium text-slate-900">
                        {a.driver.name}
                        {a.isPrimary ? <Badge tone="blue">primary</Badge> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {a.driver.phone ?? "no phone"} · licence{" "}
                        {a.driver.driverProfile?.licenseNo ?? "—"}
                      </p>
                    </div>
                    <ActionForm
                      action={unassignBusDriver}
                      hidden={{ assignmentId: a.id, busId: bus.id }}
                      label="Unassign"
                      className="btn-ghost text-xs text-red-600"
                      confirm={`Remove ${a.driver.name} from this bus? Past trips keep the record.`}
                    />
                  </li>
                ))}
              </ul>
            )}

            {assignableDrivers.length > 0 ? (
              <div className="mt-5 border-t border-slate-200 pt-5">
                <QuickForm
                  fields={[
                    {
                      kind: "select",
                      name: "driverId",
                      label: "Driver",
                      required: true,
                      options: assignableDrivers.map((d) => ({
                        value: d.id,
                        label: `${d.name} · ${d.profile?.licenseNo ?? "—"}`,
                      })),
                    },
                    {
                      kind: "checkbox",
                      name: "isPrimary",
                      label: "Primary driver",
                      defaultChecked: active.length === 0,
                      help: "A primary driver is the one parents see for this bus.",
                    },
                  ]}
                  action={assignBusDriver}
                  submitLabel="Assign driver"
                  hidden={{ busId: bus.id }}
                  columns={2}
                />
              </div>
            ) : null}

            {past.length > 0 ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-slate-500">
                  {past.length} previous assignment{past.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {past.map((a) => (
                    <li key={a.id}>
                      {a.driver.name} · {formatDate(a.validFrom)} to{" "}
                      {formatDate(a.validTo)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Summary</CardTitle>
            <DetailList
              items={[
                {
                  label: "Status",
                  value: <Badge tone={STATUS_TONE[bus.status]}>{bus.status.toLowerCase()}</Badge>,
                },
                {
                  label: "Route",
                  value: load?.route ? (
                    <Link
                      href={`/admin/routes/${load.route.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {load.route.name}
                    </Link>
                  ) : (
                    <span className="text-amber-600">none</span>
                  ),
                },
                { label: "Capacity", value: `${bus.capacity} seats` },
                {
                  label: "Enrolled",
                  value: (
                    <span className={load?.overbooked ? "font-semibold text-red-600" : ""}>
                      {load?.enrolled ?? 0} students
                    </span>
                  ),
                },
                { label: "On board now", value: bus.onboardCount },
                { label: "Trips run", value: bus._count.trips },
                { label: "Added", value: formatDate(bus.createdAt) },
              ]}
            />
          </Card>

          {load && load.byStop.length > 0 ? (
            <Card>
              <CardTitle>Students by stop</CardTitle>
              <ul className="space-y-2 text-sm">
                {load.byStop
                  .sort((a, b) => b.count - a.count)
                  .map((s) => (
                    <li key={s.stop} className="flex items-center justify-between">
                      <span className="text-slate-700">{s.stop}</span>
                      <span className="tabular-nums font-medium text-slate-900">
                        {s.count}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardTitle>Enrol students</CardTitle>
            <p className="text-xs text-slate-500">
              Assignments are made from the Students screen, where you pick the stop
              and direction together.
            </p>
            <Link href="/admin/students" className="btn-secondary mt-3 w-full">
              Go to Students
            </Link>
          </Card>

          <Card>
            <CardTitle>Danger zone</CardTitle>
            {busDeletable ? (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  This bus has never run a trip and nobody is assigned to it, so it can
                  be removed outright.
                </p>
                <ActionForm
                  action={deleteBus}
                  hidden={{ id: bus.id }}
                  label="Delete bus permanently"
                  className="btn-danger w-full"
                  confirm={`Delete bus ${bus.busNumber} (${bus.registrationNo}) for good? This cannot be undone.`}
                />
              </>
            ) : (
              <p className="text-xs text-slate-500">
                Delete is unavailable
                {[
                  bus._count.trips > 0 ? `${bus._count.trips} trip(s) on record` : null,
                  bus._count.enrollments > 0
                    ? `${bus._count.enrollments} student(s) assigned`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" and ")}
                . Set it to inactive instead: it drops out of trip scheduling and
                enrolment dropdowns, and every past trip stays readable.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
