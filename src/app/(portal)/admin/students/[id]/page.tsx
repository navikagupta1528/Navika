import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, StatTile, EmptyState } from "@/components/ui/primitives";
import { DataTable, Row, Cell, DetailList } from "@/components/admin/data-table";
import {
  getStudentAttendanceHistory,
  getStudentDetail,
} from "@/lib/admin/student-detail";
import { summariseAttendance } from "@/lib/attendance-summary";
import { validateRange } from "@/lib/admin/export-range";
import { formatDate, formatTime } from "@/lib/utils";

export const metadata = { title: "Student" };

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Default window: last 90 days, which is roughly a term. */
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 89);
  return { from: iso(from), to: iso(to) };
}

const STATUS_TONE = {
  PICKED: "emerald",
  MISSED: "red",
  ABSENT: "amber",
  WAITING: "blue",
  PENDING: "slate",
} as const;

const STATUS_LABEL = {
  PICKED: "picked",
  MISSED: "missed",
  ABSENT: "never waited",
  WAITING: "waiting, not picked",
  PENDING: "unresolved",
} as const;

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { id } = await params;
  const { from: qFrom, to: qTo } = await searchParams;

  const student = await getStudentDetail(id);
  if (!student) notFound();

  /*
   * The nav lives in the admin layout and already lists Students. This page is
   * deliberately not added to it: it is a child of one student, reached from
   * that student's row, and a sidebar entry pointing at "whoever was last
   * clicked" would be meaningless.
   */

  /*
   * The range is validated here rather than merely parsed. The reports page
   * checks with `Date.parse`, which accepts things this export does not; sharing
   * one validator means a range that exports is a range the page can render, so
   * the two can never disagree about what the window is.
   */
  const fallback = defaultRange();
  const range = validateRange(qFrom ?? fallback.from, qTo ?? fallback.to);
  const from = range.ok ? range.from : fallback.from;
  const to = range.ok ? range.to : fallback.to;

  const history = await getStudentAttendanceHistory(id, from, to);

  // Rows belonging to a trip that never ran are not evidence of anything, so
  // they are excluded from the summary. Including them would let an admin who
  // cancelled forty trips this month make forty attendance records vanish and
  // have every rate on the screen move for the wrong reason.
  const settledRows = history.filter((r) => r.tripStatus === "COMPLETED");
  const summary = summariseAttendance(
    settledRows.map((r) => ({
      date: r.date,
      direction: r.direction,
      status: r.status,
      stop: r.stopName,
    })),
  );

  const unsettled = history.length - settledRows.length;
  const needsAttention = summary.sinceLastPickup >= 2 || (summary.missed ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={student.user.name}
        description={`${student.enrollmentNo}${student.department ? ` · ${student.department}` : ""}${student.yearOfStudy ? ` · year ${student.yearOfStudy}` : ""}`}
        icon="students"
        action={
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/admin/students/${id}/history.csv?from=${from}&to=${to}`}
              className="btn-secondary"
              download
            >
              Download history
            </a>
            <Link href={`/admin/students?edit=${id}`} className="btn-ghost">
              Edit assignment
            </Link>
            <Link href="/admin/students" className="btn-ghost">
              Back
            </Link>
          </div>
        }
      />

      <div className="space-y-6">
        {needsAttention ? (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 inset-ring-1 inset-ring-amber-200">
            <p className="font-medium">Worth a phone call</p>
            <p className="mt-0.5 text-xs">
              {summary.missed} of {summary.picked + summary.missed} settled pickups were
              missed
              {summary.sinceLastPickup > 0
                ? `, and the last ${summary.sinceLastPickup} in a row were not picked up`
                : ""}
              {summary.longestGap > 2 ? ` (longest gap: ${summary.longestGap} trips)` : ""}.
              {" "}
              {student.guardians.length === 0
                ? "No guardian is linked, so nobody else would have been told."
                : `Guardian${student.guardians.length > 1 ? "s" : ""}: ${student.guardians
                    .map((g) => g.parent.user.name)
                    .join(", ")}.`}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Pick-up rate"
            value={summary.pickRate == null ? "—" : `${summary.pickRate}%`}
            sub={`${summary.picked + summary.missed} settled`}
            tone={
              summary.pickRate == null
                ? "slate"
                : summary.pickRate >= 95
                  ? "emerald"
                  : summary.pickRate >= 85
                    ? "amber"
                    : "red"
            }
          />
          <StatTile
            label="Missed"
            value={summary.missed}
            tone={summary.missed > 0 ? "red" : "emerald"}
          />
          <StatTile
            label="Since last pickup"
            value={summary.sinceLastPickup}
            sub={summary.sinceLastPickup === 1 ? "trip" : "trips"}
            tone={summary.sinceLastPickup >= 2 ? "red" : "slate"}
          />
          <StatTile
            label="Trips in range"
            value={summary.total}
            sub={summary.stopsUsed === 1 ? "1 stop" : `${summary.stopsUsed} stops`}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <Card>
              <CardTitle
                icon="students"
                hint="Only completed trips count. Cancelled ones are excluded, not shown as misses."
                action={
                  <form method="get" className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="label" htmlFor="from">
                        From
                      </label>
                      <input
                        id="from"
                        name="from"
                        type="date"
                        defaultValue={from}
                        className="field w-40 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="to">
                        To
                      </label>
                      <input
                        id="to"
                        name="to"
                        type="date"
                        defaultValue={to}
                        className="field w-40 py-1.5 text-xs"
                      />
                    </div>
                    <button type="submit" className="btn-secondary px-3 py-1.5 text-xs">
                      Apply
                    </button>
                  </form>
                }
              >
                Attendance history
              </CardTitle>

              {!range.ok ? (
                <p className="text-xs text-amber-700">
                  Showing the last 90 days instead - {range.error}
                </p>
              ) : null}

              {history.length === 0 ? (
                <EmptyState
                  icon="trips"
                  title="No trips in this range"
                  description="Attendance appears once the student is on a bus assignment and a trip has run. Try a wider date range."
                />
              ) : (
                <>
                  {unsettled > 0 ? (
                    <p className="mb-3 text-xs text-slate-500">
                      {unsettled} of {history.length} rows belong to trips that were
                      cancelled or never completed. They are listed below but left out
                      of the figures above.
                    </p>
                  ) : null}

                  <DataTable head={["Date", "Direction", "Bus", "Stop", "Status", "When", ""]}>
                    {history.slice(0, 200).map((r) => {
                      /*
                       * A row's own status can be PENDING while its trip was
                       * cancelled. In that case the trip's fate is the more useful
                       * thing to show, and labelling the row "unresolved" would
                       * imply something is still going to happen that is not.
                       *
                       * Typed by narrowing rather than cast, so a trip status added
                       * to the schema later cannot silently fall through to a
                       * missing badge tone.
                       */
                      const completed = r.tripStatus === "COMPLETED";
                      return (
                        <Row key={r.id}>
                          <Cell className="whitespace-nowrap text-slate-900">
                            {formatDate(new Date(`${r.date}T00:00:00`))}
                          </Cell>
                          <Cell>
                            <Badge tone={r.direction === "PICKUP" ? "blue" : "violet"}>
                              {r.direction === "PICKUP" ? "to college" : "to home"}
                            </Badge>
                          </Cell>
                          <Cell className="whitespace-nowrap text-slate-600">
                            {r.busNumber}
                          </Cell>
                          <Cell className="text-slate-600">{r.stopName}</Cell>
                          <Cell>
                            {completed ? (
                              <Badge tone={STATUS_TONE[r.status]}>
                                {STATUS_LABEL[r.status]}
                              </Badge>
                            ) : (
                              <Badge tone="slate">
                                trip {r.tripStatus.toLowerCase()}
                              </Badge>
                            )}
                          </Cell>
                          <Cell className="whitespace-nowrap text-xs text-slate-500">
                            {r.pickedAt
                              ? `picked ${formatTime(r.pickedAt)}`
                              : r.waitingMarkedAt
                                ? `waited from ${formatTime(r.waitingMarkedAt)}`
                                : "—"}
                          </Cell>
                          <Cell className="text-right">
                            <Link
                              href={`/admin/trips/${r.tripId}`}
                              className="btn-ghost px-2 py-1 text-xs"
                            >
                              Trip
                            </Link>
                          </Cell>
                        </Row>
                      );
                    })}
                  </DataTable>

                  {history.length > 200 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      Showing the 200 most recent of {history.length}. Narrow the date
                      range, or download the CSV for all of them.
                    </p>
                  ) : null}
                </>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardTitle icon="students">Student</CardTitle>
              <DetailList
                items={[
                  { label: "Enrolment no", value: student.enrollmentNo },
                  { label: "Department", value: student.department ?? "—" },
                  { label: "Year", value: student.yearOfStudy ?? "—" },
                  {
                    label: "Email",
                    value: (
                      <a
                        href={`mailto:${student.user.email}`}
                        className="text-brand-700 hover:underline"
                      >
                        {student.user.email}
                      </a>
                    ),
                  },
                  { label: "Phone", value: student.user.phone ?? "—" },
                  {
                    label: "Account",
                    value: student.user.isActive ? (
                      <Badge tone="emerald">active</Badge>
                    ) : (
                      <Badge tone="slate">deactivated</Badge>
                    ),
                  },
                ]}
              />
            </Card>

            <Card>
              <CardTitle
                icon="bus"
                hint="One per direction. Past assignments stay on record."
              >
                Bus assignments
              </CardTitle>
              {student.enrollments.length === 0 ? (
                <p className="text-sm text-amber-700">
                  Not assigned to a bus. This student will not appear on any roster.
                </p>
              ) : (
                <ul className="space-y-3">
                  {student.enrollments.map((e) => (
                    <li key={e.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={e.direction === "PICKUP" ? "blue" : "violet"}>
                          {e.direction === "PICKUP" ? "to college" : "to home"}
                        </Badge>
                        <Link
                          href={`/admin/buses/${e.bus.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {e.bus.busNumber}
                        </Link>
                        {e.bus.isSimulated ? <Badge tone="amber">simulated</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {/*
                          A bus can have no route assigned, so this cannot be
                          assumed. It is worth rendering "no route" rather than
                          hiding the whole assignment - the student is still
                          enrolled, and an admin looking at this page is trying
                          to work out why.
                        */}
                        {e.bus.route ? e.bus.route.name : "no route assigned"} · {e.stop.name}{" "}
                        · {e.academicYear}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {student.endedEnrollments.length > 0 ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    {student.endedEnrollments.length} ended assignments
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {student.endedEnrollments.map((e) => (
                      <li key={e.id}>
                        <span className="line-through">
                          {e.bus.busNumber} at {e.stop.name} (
                          {e.direction === "PICKUP" ? "to college" : "to home"},{" "}
                          {e.academicYear})
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </Card>

            <Card>
              <CardTitle
                icon="users"
                hint="Notifications need at least one linked guardian."
              >
                Guardians
              </CardTitle>
              {student.guardians.length === 0 ? (
                <p className="text-sm text-amber-700">
                  None linked. Pickup and emergency alerts have nowhere to go for this
                  student.
                </p>
              ) : (
                <ul className="space-y-2">
                  {student.guardians.map((g) => (
                    <li key={g.id} className="text-sm">
                      <p className="font-medium text-slate-900">{g.parent.user.name}</p>
                      <p className="text-xs text-slate-500">
                        {g.parent.user.phone ? g.parent.user.phone : "no phone on file"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}