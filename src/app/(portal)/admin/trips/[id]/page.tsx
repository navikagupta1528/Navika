import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getTripDetail, listDrivers } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, EmptyState, StatTile } from "@/components/ui/primitives";
import { DetailList } from "@/components/admin/data-table";
import { ActionForm } from "@/components/admin/action-form";
import { QuickForm } from "@/components/admin/entity-form";
import {
  cancelTrip,
  closeStop,
  completeTrip,
  reassignTripDriver,
  setPickupStatus,
  startTrip,
} from "@/app/actions/admin/trips";
import { formatDate, formatTime } from "@/lib/utils";

export const metadata = { title: "Trip" };

const STATUS_TONE = {
  SCHEDULED: "blue",
  ONGOING: "emerald",
  COMPLETED: "slate",
  CANCELLED: "red",
} as const;

const PICKUP_TONE: Record<string, "slate" | "amber" | "emerald" | "red"> = {
  PENDING: "slate",
  WAITING: "amber",
  PICKED: "emerald",
  MISSED: "red",
  ABSENT: "red",
};

const PICKUP_LABEL: Record<string, string> = {
  PENDING: "not marked",
  WAITING: "waiting",
  PICKED: "picked",
  MISSED: "missed",
  ABSENT: "absent",
};

function formatDelay(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.round(Math.abs(seconds) / 60);
  if (mins < 1) return "<1 min";
  return `${mins} min${seconds < 0 ? " early" : " late"}`;
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { id } = await params;
  const [detail, drivers] = await Promise.all([getTripDetail(id), listDrivers()]);
  if (!detail) notFound();

  const { trip, stops, counts, expectedCount } = detail;
  const activeDrivers = drivers.filter((d) => d.isActive && d.profile);
  const otherDrivers = activeDrivers.filter((d) => d.id !== trip.driverId);

  const total = counts.picked + counts.waiting + counts.missed + counts.absent + counts.pending;
  const editable = trip.status === "ONGOING";

  return (
    <>
      <PageHeader
        title={`${trip.bus.busNumber} · ${trip.direction === "PICKUP" ? "Home to college" : "College to home"}`}
        description={`${formatDate(trip.date)} · planned ${formatTime(trip.scheduledStart)} · ${trip.bus.route?.name ?? "no route"}`}
        action={
          <Link href="/admin/trips" className="btn-secondary">
            Back to trips
          </Link>
        }
      />

      <div className="space-y-6">
        {/* Status banner: the one thing an admin needs before anything else. */}
        {trip.status === "SCHEDULED" ? (
          <div className="rounded-xl bg-blue-50 px-4 py-4 text-sm text-blue-900 inset-ring-1 inset-ring-blue-200">
            <p className="font-medium">Not started yet</p>
            <p className="mt-0.5 text-xs">
              Starting the trip creates one attendance row per enrolled student for this
              direction, and marks the bus as on the road.
            </p>
            <div className="mt-3">
              <ActionForm
                action={startTrip}
                hidden={{ id: trip.id }}
                label="Start trip now"
                pendingLabel="Starting…"
                className="btn-primary px-3 py-1.5 text-xs"
              />
            </div>
          </div>
        ) : null}

        {trip.status === "ONGOING" ? (
          <div className="rounded-xl bg-emerald-50 px-4 py-4 text-sm text-emerald-900 inset-ring-1 inset-ring-emerald-200">
            <p className="font-medium">On the road since {formatTime(trip.startedAt)}</p>
            <p className="mt-0.5 text-xs">
              Check students off as they board. When the bus reaches a stop, use
              &ldquo;Close stop&rdquo; to record everyone still pending as missed.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionForm
                action={completeTrip}
                hidden={{ id: trip.id }}
                label="Complete trip"
                className="btn-primary px-3 py-1.5 text-xs"
                confirm="Complete this trip? Anyone still pending or waiting is recorded as missed and cannot be picked up afterwards."
              />
              <ActionForm
                action={cancelTrip}
                hidden={{ id: trip.id }}
                label="Cancel trip"
                className="btn-secondary px-3 py-1.5 text-xs"
                confirm="Cancel this trip mid-run? Parents will be told the service was cancelled."
              />
            </div>
          </div>
        ) : null}

        {trip.status === "CANCELLED" ? (
          <div className="rounded-xl bg-red-50 px-4 py-4 text-sm text-red-900 inset-ring-1 inset-ring-red-200">
            <p className="font-medium">This trip was cancelled</p>
            <p className="mt-0.5 text-xs">
              The attendance below is kept for the record but cannot be changed. Schedule a
              replacement trip for the same direction.
            </p>
          </div>
        ) : null}

        {trip.status === "COMPLETED" ? (
          <div className="rounded-xl bg-slate-100 px-4 py-4 text-sm text-slate-800 inset-ring-1 inset-ring-slate-200">
            <p className="font-medium">
              Completed{trip.endedAt ? ` at ${formatTime(trip.endedAt)}` : ""}
            </p>
            <p className="mt-0.5 text-xs">
              {counts.picked} of {total} students were picked up. This is now a permanent
              record and cannot be edited.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile label="Expected" value={total} sub="on this trip" />
          <StatTile label="Picked" value={counts.picked} tone="emerald" />
          <StatTile
            label="Waiting"
            value={counts.waiting}
            tone={counts.waiting > 0 ? "amber" : "slate"}
          />
          <StatTile
            label="Missed"
            value={counts.missed}
            tone={counts.missed > 0 ? "red" : "slate"}
          />
          <StatTile
            label="Not marked"
            value={counts.pending}
            tone={counts.pending > 0 ? "slate" : "slate"}
            sub={trip.status === "SCHEDULED" ? "before start" : undefined}
          />
        </div>

        {trip.status === "SCHEDULED" ? (
          <Card>
            <CardTitle hint="Nobody can be marked until the trip starts, because attendance rows are created at start.">
              Attendance preview
            </CardTitle>
            <p className="text-sm text-slate-600">
              Starting this trip will generate an attendance row for each of the{" "}
              <strong>{expectedCount}</strong> active{" "}
              {expectedCount === 1 ? "enrolment" : "enrolments"} on bus{" "}
              {trip.bus.busNumber} for this direction.
            </p>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {stops.length === 0 ? (
              <EmptyState
                title="This route has no stops"
                description="Without stops there is no roster to build. Add stops to the route, then schedule a new trip."
                action={
                  <Link href={`/admin/routes/${trip.bus.route?.id ?? ""}`} className="btn-secondary">
                    Edit route
                  </Link>
                }
              />
            ) : (
              stops.map((bucket) => {
                const attended = bucket.arrivedAt != null;
                const picked = bucket.students.filter((s) => s.status === "PICKED").length;
                const outstanding = bucket.students.filter(
                  (s) => s.status === "PENDING" || s.status === "WAITING",
                ).length;

                return (
                  <Card key={bucket.stop.id}>
                    <CardTitle
                      hint={
                        bucket.scheduledHHMM
                          ? `Planned ${bucket.scheduledHHMM}${attended ? ` · arrived ${formatTime(bucket.arrivedAt)}` : ""}`
                          : attended
                            ? `Arrived ${formatTime(bucket.arrivedAt)}`
                            : "No time set on the route"
                      }
                      action={
                        <div className="flex items-center gap-2">
                          {bucket.stopOrder != null ? (
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                              {bucket.stopOrder}
                            </span>
                          ) : null}
                          {editable && outstanding > 0 ? (
                            <ActionForm
                              action={closeStop}
                              hidden={{ tripId: trip.id, stopId: bucket.stop.id }}
                              label={`Close stop (${outstanding})`}
                              className="btn-secondary px-2.5 py-1 text-xs"
                              confirm={`Mark ${outstanding} student(s) at ${bucket.stop.name} as missed?`}
                            />
                          ) : null}
                        </div>
                      }
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        {bucket.stop.name}
                        {bucket.stopOrder == null ? (
                          <Badge tone="amber">not on this route</Badge>
                        ) : null}
                        {bucket.students.length === 0 ? (
                          <span className="text-xs font-normal text-slate-400">
                            nobody enrolled here
                          </span>
                        ) : (
                          <span className="text-xs font-normal text-slate-500">
                            {picked}/{bucket.students.length} picked
                          </span>
                        )}
                        {attended ? <Badge tone="blue">visited</Badge> : null}
                      </span>
                    </CardTitle>

                    {bucket.students.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        The bus still stops here, but no student is assigned to this point.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {bucket.students.map((record) => (
                          <li
                            key={record.id}
                            className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900">
                                {record.student.user.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {record.student.enrollmentNo}
                                {record.student.user.phone ? ` · ${record.student.user.phone}` : ""}
                                {record.waitingMarkedAt
                                  ? ` · marked waiting ${formatTime(record.waitingMarkedAt)}`
                                  : ""}
                                {record.pickedAt
                                  ? ` · on board ${formatTime(record.pickedAt)}`
                                  : ""}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <Badge tone={PICKUP_TONE[record.status]}>
                                {PICKUP_LABEL[record.status]}
                              </Badge>
                              {editable ? (
                                <div className="flex items-center gap-1">
                                  <ActionForm
                                    action={setPickupStatus}
                                    hidden={{
                                      recordId: record.id,
                                      tripId: trip.id,
                                      status: "PICKED",
                                    }}
                                    label="Picked"
                                    className="btn-primary px-2 py-1 text-[11px]"
                                    ariaLabel={`Mark ${record.student.user.name} as picked`}
                                  />
                                  <ActionForm
                                    action={setPickupStatus}
                                    hidden={{
                                      recordId: record.id,
                                      tripId: trip.id,
                                      status: "MISSED",
                                    }}
                                    label="Missed"
                                    className="btn-ghost px-2 py-1 text-[11px] text-red-600"
                                    ariaLabel={`Mark ${record.student.user.name} as missed`}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardTitle>Trip</CardTitle>
              <DetailList
                items={[
                  {
                    label: "Status",
                    value: <Badge tone={STATUS_TONE[trip.status]}>{trip.status.toLowerCase()}</Badge>,
                  },
                  { label: "Date", value: formatDate(trip.date) },
                  { label: "Planned start", value: formatTime(trip.scheduledStart) },
                  { label: "Started", value: formatTime(trip.startedAt) },
                  { label: "Ended", value: formatTime(trip.endedAt) },
                  {
                    label: "Start delay",
                    value: (
                      <span
                        className={
                          (trip.delaySeconds ?? 0) > 300
                            ? "font-medium text-amber-600"
                            : undefined
                        }
                      >
                        {formatDelay(trip.delaySeconds)}
                      </span>
                    ),
                  },
                  {
                    label: "Bus",
                    value: (
                      <Link
                        href={`/admin/buses/${trip.bus.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {trip.bus.busNumber}
                      </Link>
                    ),
                  },
                  { label: "Registration", value: trip.bus.registrationNo },
                  {
                    label: "Route",
                    value: trip.bus.route ? (
                      <Link
                        href={`/admin/routes/${trip.bus.route.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {trip.bus.route.name}
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                  { label: "Stops on route", value: trip.bus.route?.routeStops.length ?? 0 },
                ]}
              />
            </Card>

            <Card>
              <CardTitle hint="Driver drives this trip, whether or not the bus is assigned to them.">
                Driver
              </CardTitle>
              <p className="text-sm font-medium text-slate-900">{trip.driver.name}</p>
              <p className="text-xs text-slate-500">
                {trip.driver.phone ?? "no phone on file"}
              </p>

              {trip.status === "SCHEDULED" && otherDrivers.length > 0 ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <QuickForm
                    fields={[
                      {
                        kind: "select",
                        name: "driverId",
                        label: "Swap driver",
                        required: true,
                        options: otherDrivers.map((d) => ({
                          value: d.id,
                          label: `${d.name} · ${d.profile?.licenseNo ?? "—"}`,
                        })),
                      },
                    ]}
                    action={reassignTripDriver}
                    submitLabel="Reassign"
                    hidden={{ id: trip.id }}
                    columns={1}
                  />
                </div>
              ) : null}
            </Card>

            {trip.alerts.length > 0 ? (
              <Card>
                <CardTitle hint="Raised during this trip">Alerts</CardTitle>
                <ul className="space-y-2 text-sm">
                  {trip.alerts.map((a) => (
                    <li key={a.id} className="rounded-lg bg-red-50 px-3 py-2 inset-ring-1 inset-ring-red-200">
                      <p className="text-xs font-medium text-red-800">
                        {a.type.replace(/_/g, " ").toLowerCase()} · {a.status.toLowerCase()}
                      </p>
                      <p className="mt-0.5 text-xs text-red-700">{a.message}</p>
                      <p className="mt-0.5 text-[11px] text-red-500">{formatTime(a.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
