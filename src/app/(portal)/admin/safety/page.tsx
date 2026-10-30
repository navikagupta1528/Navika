import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { getDriverSafetyScores } from "@/lib/admin/reports";
import { scoreTone } from "@/lib/driving";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, StatTile, EmptyState } from "@/components/ui/primitives";
import {
  DataTable,
  Row,
  Cell,
  TableEmpty,
} from "@/components/admin/data-table";

export const metadata = { title: "Driver safety" };

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Default window: the last 30 days, matching the reports screen. */
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: iso(from), to: iso(to) };
}

export default async function SafetyPage({
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

  const scores = invalid ? [] : await getDriverSafetyScores(from, to);

  const totalEvents = scores.reduce((sum, s) => sum + s.total, 0);
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)
      : null;

  return (
    <>
      <PageHeader
        title="Driver safety"
        description="How the fleet is being driven, scored from the GPS stream. Worst first."
        icon="shield"
      />

      <div className="space-y-6">
        <Card>
          <CardTitle icon="clock" hint="Events are detected from consecutive GPS fixes.">
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
              href={`/admin/safety?from=${fallback.from}&to=${fallback.to}`}
              className="btn-ghost"
            >
              Last 30 days
            </Link>
          </form>
        </Card>

        {invalid ? (
          <EmptyState
            icon="alert"
            title="Invalid date range"
            description="Pick two valid dates and run the report again."
          />
        ) : scores.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No driving events in this range"
            description="Events are detected while a trip is running. Once a driver completes a trip, their harsh brakes, hard accelerations and overspeeds appear here."
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
                label="Drivers scored"
                value={scores.length}
                tone="blue"
                icon="drivers"
              />
              <StatTile
                label="Average score"
                value={avgScore == null ? "—" : `${avgScore}`}
                tone={avgScore == null ? "slate" : avgScore >= 80 ? "emerald" : avgScore >= 60 ? "amber" : "red"}
                icon="gauge"
              />
              <StatTile
                label="Events detected"
                value={totalEvents}
                tone={totalEvents > 0 ? "amber" : "slate"}
                icon="activity"
              />
              <StatTile
                label="Needs coaching"
                value={scores.filter((s) => scoreTone(s.score).tone === "poor").length}
                tone={scores.some((s) => scoreTone(s.score).tone === "poor") ? "red" : "emerald"}
                icon="shieldAlert"
              />
            </div>

            <Card>
              <CardTitle
                icon="drivers"
                hint="Sorted worst first — the driver who needs a conversation is at the top."
              >
                Driver scores
              </CardTitle>
              <DataTable head={["Driver", "Score", "Harsh brakes", "Hard accel.", "Overspeed", "Events"]}>
                {scores.length === 0 ? (
                  <TableEmpty colSpan={6}>Nothing in this range.</TableEmpty>
                ) : (
                  scores.map((s) => {
                    const tone = scoreTone(s.score);
                    return (
                      <Row key={s.driverId}>
                        <Cell>
                          <Link
                            href={`/admin/drivers/${s.driverId}`}
                            className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                          >
                            {s.name}
                          </Link>
                        </Cell>
                        <Cell>
                          <Badge
                            tone={
                              tone.tone === "good"
                                ? "emerald"
                                : tone.tone === "fair"
                                  ? "amber"
                                  : "red"
                            }
                          >
                            {s.score} · {tone.label}
                          </Badge>
                        </Cell>
                        <Cell className="tabular-nums text-slate-600">{s.counts.HARSH_BRAKING}</Cell>
                        <Cell className="tabular-nums text-slate-600">
                          {s.counts.HARD_ACCELERATION}
                        </Cell>
                        <Cell className="tabular-nums text-slate-600">{s.counts.OVERSPEED}</Cell>
                        <Cell className="tabular-nums text-slate-600">{s.total}</Cell>
                      </Row>
                    );
                  })
                )}
              </DataTable>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
