import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { countTripsByStatus, listTrips, listBuses, listDrivers } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Pagination } from "@/components/portal/pagination";
import { Card, CardTitle, Badge, StatTile, EmptyState } from "@/components/ui/primitives";
import { EntityForm } from "@/components/admin/entity-form";
import { ActionForm } from "@/components/admin/action-form";
import { tripFields } from "@/lib/admin/form-defs";
import {
  cancelTrip,
  completeTrip,
  scheduleTrip,
  startTrip,
} from "@/app/actions/admin/trips";
import { formatDate, formatTime } from "@/lib/utils";

export const metadata = { title: "Trips" };

const STATUS_TONE = {
  SCHEDULED: "blue",
  ONGOING: "emerald",
  COMPLETED: "slate",
  CANCELLED: "red",
} as const;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function delayLabel(seconds: number | null): string | null {
  if (seconds == null) return null;
  const abs = Math.abs(seconds);
  const mins = Math.round(abs / 60);
  if (mins < 1) return "under a minute";
  return `${mins} min`;
}

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    status?: string;
    page?: string | string[];
  }>;
}) {
  await requireRole(Role.ADMIN);
  const { date, status, page: rawPage } = await searchParams;

  const activeDate = date ?? todayIso();
  const [list, buses, drivers, counts] = await Promise.all([
    listTrips({ date: activeDate, status: status || undefined, page: rawPage }),
    listBuses(),
    listDrivers(),
    // Counted over the whole day, not summed from the page - see the note on
    // `countTripsByStatus`.
    countTripsByStatus(activeDate),
  ]);

  const { trips, page } = list;

  const scheduled = buses.filter((b) => b.status === "ACTIVE" && b.routeId);
  const activeDrivers = drivers.filter((d) => d.isActive && d.profile);

  const STATUS_FILTERS = [
    { value: "", label: "All" },
    { value: "SCHEDULED", label: "Scheduled" },
    { value: "ONGOING", label: "Ongoing" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
  ];

  return (
    <>
      <PageHeader
        title="Trips"
        description="One run of a bus in one direction on one day. Starting a trip creates its attendance sheet."
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Scheduled" value={counts.SCHEDULED} tone="blue" />
          <StatTile
            label="On the road"
            value={counts.ONGOING}
            tone={counts.ONGOING > 0 ? "emerald" : "slate"}
          />
          <StatTile label="Completed" value={counts.COMPLETED} />
          <StatTile
            label="Cancelled"
            value={counts.CANCELLED}
            tone={counts.CANCELLED > 0 ? "red" : "slate"}
          />
        </div>

        <Card>
          <CardTitle hint="One trip per bus per direction per day, enforced by the database.">
            Schedule a trip
          </CardTitle>
          {scheduled.length === 0 ? (
            <EmptyState
              title="No bus is ready to run"
              description="A bus needs to be active and have a route with at least one stop. Fix that on the Fleet and Routes screens first."
              action={
                <Link href="/admin/buses" className="btn-secondary">
                  Go to Fleet
                </Link>
              }
            />
          ) : activeDrivers.length === 0 ? (
            <EmptyState
              title="No active driver"
              description="Trips need a driver. Create one on the Drivers screen."
              action={
                <Link href="/admin/drivers/new" className="btn-primary">
                  Add a driver
                </Link>
              }
            />
          ) : (
            <EntityForm
              fields={tripFields({
                buses: scheduled.map((b) => ({
                  value: b.id,
                  label: `${b.busNumber} · ${b.route?.name ?? "no route"}`,
                })),
                drivers: activeDrivers.map((d) => ({
                  value: d.id,
                  label: `${d.name} · ${d.profile?.licenseNo ?? "—"}`,
                })),
              }).map((f) =>
                f.name === "date" ? { ...f, defaultValue: activeDate } : f,
              )}
              action={scheduleTrip}
              submitLabel="Schedule trip"
            />
          )}
        </Card>

        <Card>
          <CardTitle
            hint={`Trips on ${formatDate(new Date(`${activeDate}T00:00:00`))}`}
            action={
              <form method="get" className="flex flex-wrap items-center gap-2">
                <label htmlFor="date" className="sr-only">
                  Date
                </label>
                <input
                  id="date"
                  name="date"
                  type="date"
                  defaultValue={activeDate}
                  className="field w-40 py-1.5 text-xs"
                />
                <label htmlFor="status" className="sr-only">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={status ?? ""}
                  className="field w-36 py-1.5 text-xs"
                >
                  {STATUS_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn-secondary px-3 py-1.5 text-xs">
                  Filter
                </button>
                {activeDate !== todayIso() ? (
                  <Link href="/admin/trips" className="btn-ghost px-2 py-1.5 text-xs">
                    Today
                  </Link>
                ) : null}
              </form>
            }
          >
            Trips
          </CardTitle>

          {trips.length === 0 ? (
            <EmptyState
              title="No trips on this date"
              description="Schedule one above, or pick a different day. Bus services normally run a pickup trip and a drop-off trip per working day."
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4 font-medium">Bus</th>
                    <th className="py-2 pr-4 font-medium">Driver</th>
                    <th className="py-2 pr-4 font-medium">Direction</th>
                    <th className="py-2 pr-4 font-medium">Planned start</th>
                    <th className="py-2 pr-4 font-medium">Actual</th>
                    <th className="py-2 pr-4 font-medium">Attendance</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trips.map((trip) => {
                    const picked = trip.pickupRecords.filter(
                      (r) => r.status === "PICKED",
                    ).length;
                    const total = trip.pickupRecords.length;
                    const delay = delayLabel(trip.delaySeconds);

                    return (
                      <tr key={trip.id}>
                        <td className="py-2.5 pr-4">
                          <Link
                            href={`/admin/trips/${trip.id}`}
                            className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                          >
                            {trip.bus.busNumber}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {trip.bus.route?.name ?? "no route"}
                          </p>
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">{trip.driver.name}</td>
                        <td className="py-2.5 pr-4">
                          <Badge tone={trip.direction === "PICKUP" ? "blue" : "violet"}>
                            {trip.direction === "PICKUP" ? "to college" : "to home"}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums text-slate-600">
                          {formatTime(trip.scheduledStart)}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums text-slate-600">
                          {trip.startedAt ? formatTime(trip.startedAt) : "—"}
                          {delay ? (
                            <span
                              className={`ml-1.5 text-xs ${
                                (trip.delaySeconds ?? 0) > 300
                                  ? "font-medium text-amber-700"
                                  : "text-slate-500"
                              }`}
                            >
                              {delay} late
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums text-slate-600">
                          {total === 0 ? (
                            <span className="text-xs text-slate-500">
                              not generated
                            </span>
                          ) : (
                            <span>
                              {picked}/{total} picked
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge tone={STATUS_TONE[trip.status]}>
                            {trip.status.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {trip.status === "SCHEDULED" ? (
                              <ActionForm
                                action={startTrip}
                                hidden={{ id: trip.id }}
                                label="Start"
                                pendingLabel="Starting…"
                                className="btn-primary px-2.5 py-1 text-xs"
                              />
                            ) : null}
                            {trip.status === "ONGOING" ? (
                              <ActionForm
                                action={completeTrip}
                                hidden={{ id: trip.id }}
                                label="Complete"
                                className="btn-secondary px-2.5 py-1 text-xs"
                                confirm="Complete this trip? Anyone not picked up is recorded as missed."
                              />
                            ) : null}
                            {trip.status !== "COMPLETED" && trip.status !== "CANCELLED" ? (
                              <ActionForm
                                action={cancelTrip}
                                hidden={{ id: trip.id }}
                                label="Cancel"
                                className="btn-ghost px-2.5 py-1 text-xs text-red-600"
                                confirm={`Cancel the ${trip.bus.busNumber} ${trip.direction === "PICKUP" ? "pickup" : "drop-off"} trip? Parents will see it as cancelled.`}
                              />
                            ) : null}
                            <Link
                              href={`/admin/trips/${trip.id}`}
                              className="btn-ghost px-2.5 py-1 text-xs"
                            >
                              Open
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination
            page={page}
            basePath="/admin/trips"
            params={{ date: activeDate, status }}
          />
        </Card>
      </div>
    </>
  );
}
