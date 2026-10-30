import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { getAttendanceReport } from "@/lib/admin/reports";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, StatTile, EmptyState } from "@/components/ui/primitives";
import {
  DataTable,
  Row,
  Cell,
  TableEmpty,
} from "@/components/admin/data-table";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Reports" };

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Default window: the last 30 days, which is what an admin actually looks at. */
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: iso(from), to: iso(to) };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { from: qFrom, to: qTo } = await searchParams;

  const fallback = defaultRange();
  const from = qFrom ?? fallback.from;
  const to = qTo ?? fallback.to;
  const invalid = Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to));

  const report = invalid
    ? null
    : await getAttendanceReport(from, to);

  const settled = report
    ? report.totals.picked + report.totals.missed
    : 0;
  const pickRate = settled > 0 ? Math.round((report!.totals.picked / settled) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Attendance across the fleet. Numbers come straight from completed trips, so they match what parents saw."
        icon="reports"
      />

      <div className="space-y-6">
        <Card>
          <CardTitle
            icon="clock"
            hint="Pickups are recorded when the driver checks a student in."
          >
            Date range
          </CardTitle>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="from">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={from}
                className="field w-44"
              />
            </div>
            <div>
              <label className="label" htmlFor="to">
                To
              </label>
              <input id="to" name="to" type="date" defaultValue={to} className="field w-44" />
            </div>
            <button type="submit" className="btn-primary">
              Run report
            </button>
            <Link
              href={`/admin/reports?from=${fallback.from}&to=${fallback.to}`}
              className="btn-ghost"
            >
              Last 30 days
            </Link>
            {/*
              The download carries the same range the report was run with, and
              only appears when that range is valid. A link that silently exported
              the default 30 days while the table above showed something else
              would be the worst version of this bug: the sheet would be
              individually correct and inconsistent with the screen it came from.
            */}
            {!invalid && from <= to ? (
              <a
                href={`/api/admin/reports/attendance.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
                className="btn-secondary ml-auto"
                download
              >
                Download CSV
              </a>
            ) : null}
          </form>
          {!invalid && from <= to ? (
            <p className="mt-3 text-xs text-slate-500">
              One row per attendance record, so a spreadsheet can build its own
              totals. The numbers on this page are aggregates of exactly these
              rows.
            </p>
          ) : null}
        </Card>

        {invalid || !report ? (
          <EmptyState
            icon="alert"
            title="Invalid date range"
            description="Pick two valid dates and run the report again."
          />
        ) : report.totals.trips === 0 ? (
          <EmptyState
            icon="trips"
            title="No completed trips in this range"
            description="Attendance is recorded when a trip finishes, so a range with only scheduled or cancelled trips has nothing to show. Try a wider window."
            action={
              <Link href="/admin/trips" className="btn-secondary">
                Go to trips
              </Link>
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Completed trips"
                value={report.totals.trips}
                tone="blue"
                icon="trips"
              />
              <StatTile
                label="Students picked"
                value={report.totals.picked}
                tone="emerald"
                icon="check"
              />
              <StatTile
                label="Missed"
                value={report.totals.missed}
                tone={report.totals.missed > 0 ? "red" : "slate"}
                icon="alert"
              />
              <StatTile
                label="Pick-up rate"
                value={`${pickRate}%`}
                sub={settled > 0 ? `${settled} expected` : undefined}
                tone={pickRate >= 95 ? "emerald" : pickRate >= 85 ? "amber" : "red"}
                icon="trendUp"
              />
            </div>

            {report.totals.pending > 0 ? (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 inset-ring-1 inset-ring-amber-200">
                <p className="font-medium">
                  {report.totals.pending} attendance rows are still unresolved
                </p>
                <p className="mt-0.5 text-xs">
                  These belong to trips that were never completed, so they are not counted
                  in the rate above. Complete or cancel those trips to settle them.
                </p>
              </div>
            ) : null}

            <Card>
              <CardTitle
                icon="bus"
                hint="Attendance is counted only from completed trips."
              >
                By bus
              </CardTitle>
              <DataTable head={["Bus", "Route", "Trips", "Picked", "Missed", "Rate"]}>
                {report.byBus.length === 0 ? (
                  <TableEmpty colSpan={6}>Nothing in this range.</TableEmpty>
                ) : (
                  report.byBus.map((bus) => {
                    const settledBus = bus.picked + bus.missed;
                    const rate =
                      settledBus > 0 ? Math.round((bus.picked / settledBus) * 100) : null;
                    return (
                      <Row key={bus.busId}>
                        <Cell>
                          <Link
                            href={`/admin/buses/${bus.busId}`}
                            className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                          >
                            {bus.busNumber}
                          </Link>
                          <p className="font-mono text-xs text-slate-500">
                            {bus.registrationNo}
                          </p>
                        </Cell>
                        <Cell className="text-slate-600">{bus.routeName ?? "—"}</Cell>
                        <Cell className="tabular-nums text-slate-600">{bus.trips}</Cell>
                        <Cell className="tabular-nums text-slate-600">{bus.picked}</Cell>
                        <Cell
                          className={
                            bus.missed > 0
                              ? "tabular-nums font-medium text-red-600"
                              : "tabular-nums text-slate-600"
                          }
                        >
                          {bus.missed}
                        </Cell>
                        <Cell>
                          {rate == null ? (
                            <span className="text-slate-500">—</span>
                          ) : (
                            <Badge
                              tone={
                                rate >= 95 ? "emerald" : rate >= 85 ? "amber" : "red"
                              }
                            >
                              {rate}%
                            </Badge>
                          )}
                        </Cell>
                      </Row>
                    );
                  })
                )}
              </DataTable>
            </Card>

            <Card>
              <CardTitle
                icon="reports"
                hint="Each bar is that day's completed trips, scaled to the busiest day."
              >
                Daily trend
              </CardTitle>
              <DailyChart daily={report.daily} />
            </Card>

            <Card>
              <CardTitle
                icon="alert"
                hint="Who was left behind most in this window. Worth a phone call."
              >
                Repeatedly missed
              </CardTitle>
              {report.chronic.length === 0 ? (
                <p className="text-sm text-emerald-700">
                  Nobody was missed in this period.
                </p>
              ) : (
                <DataTable head={["Student", "Bus", "Times missed", ""]}>
                  {report.chronic.map((c) => (
                    <Row key={c.studentId}>
                      <Cell>
                        <p className="font-medium text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">{c.enrollmentNo}</p>
                      </Cell>
                      <Cell className="text-slate-600">{c.busNumber}</Cell>
                      <Cell className="tabular-nums font-medium text-red-600">{c.missed}</Cell>
                      <Cell className="text-right">
                        {/*
                          Links to that child's history, not to a search for their
                          roll number. Whoever reads this table has a name in front
                          of them and wants this child's record; sending them back
                          to a search box to re-find it is a step with no purpose.
                        */}
                        <Link
                          href={`/admin/students/${c.studentId}`}
                          className="btn-ghost px-2 py-1 text-xs"
                        >
                          History
                        </Link>
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}

/**
 * A plain CSS bar chart.
 *
 * No chart library: this is one series of two values per day, and pulling in
 * Chart.js or Recharts to draw twelve divs would add a client bundle and a
 * hydration cost for no benefit.
 */
function DailyChart({
  daily,
}: {
  daily: { date: string; picked: number; missed: number; trips: number }[];
}) {
  const max = Math.max(...daily.map((d) => d.picked + d.missed), 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> picked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> missed
        </span>
        <span className="ml-auto text-slate-500">
          {formatDate(new Date(`${daily[0]!.date}T00:00:00`))} →{" "}
          {formatDate(new Date(`${daily[daily.length - 1]!.date}T00:00:00`))}
        </span>
      </div>

      <div className="flex h-40 items-end gap-1.5 overflow-x-auto pb-1">
        {daily.map((d) => {
          const pickedH = Math.round((d.picked / max) * 100);
          const missedH = Math.round((d.missed / max) * 100);
          return (
            <div
              key={d.date}
              className="flex min-w-8 flex-1 flex-col items-center gap-1"
              title={`${d.date}: ${d.picked} picked, ${d.missed} missed, ${d.trips} trips`}
            >
              <div className="flex h-32 w-full flex-col justify-end">
                {missedH > 0 ? (
                  <div
                    className="w-full rounded-t-sm bg-red-400"
                    style={{ height: `${missedH}%` }}
                  />
                ) : null}
                {pickedH > 0 ? (
                  <div
                    className="w-full bg-emerald-500"
                    style={{
                      height: `${pickedH}%`,
                      borderRadius: missedH > 0 ? "0 0 2px 2px" : "2px",
                    }}
                  />
                ) : (
                  <div className="h-0.5 w-full rounded-sm bg-slate-200" />
                )}
              </div>
              <span className="text-[10px] text-slate-500">
                {new Date(`${d.date}T00:00:00`).getDate()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
