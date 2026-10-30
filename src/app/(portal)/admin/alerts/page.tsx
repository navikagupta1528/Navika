import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listAlerts } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { describeWindow } from "@/lib/pagination";
import { PageHeader } from "@/components/portal/portal-shell";
import { Pagination } from "@/components/portal/pagination";
import { Card, CardTitle, Badge, StatTile, EmptyState } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import {
  acknowledgeAlert,
  reopenAlert,
  resolveAlert,
} from "@/app/actions/admin/alerts";
import { formatDate, formatTime, timeAgo } from "@/lib/utils";

export const metadata = { title: "Alerts" };

const STATUS_TONE = {
  OPEN: "red",
  ACKNOWLEDGED: "amber",
  RESOLVED: "emerald",
} as const;

/**
 * Total alerts across every status.
 *
 * For the "All (n)" chip, which shows what you would get by clearing the filter.
 * Summing the three counts rather than reusing the pager's total, because the
 * pager's total already respects the current filter - so under "Open (4)" it is
 * 4, and the All chip would read "All (4)" for a queue of thirty.
 */
function countAll(counts: Record<string, number>): number {
  return Object.values(counts).reduce((n, v) => n + v, 0);
}

const TYPE_LABEL: Record<string, string> = {
  EMERGENCY: "Emergency",
  BREAKDOWN: "Breakdown",
  DELAY: "Delay",
  ACCIDENT: "Accident",
  OTHER: "Other",
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string | string[] }>;
}) {
  await requireRole(Role.ADMIN);
  const { status, page: rawPage } = await searchParams;

  /*
   * The status filter and the page are applied in the database.
   *
   * This page used to fetch the newest hundred alerts and filter them in memory,
   * which put two wrong numbers on screen: the list was silently missing whatever
   * came after the hundred, and the tiles counted from those hundred - so
   * "Needs a response 2" could be two of the last hundred, not two in total. For
   * an emergency queue, an understated count is the failure mode that hurts.
   */
  const { alerts, statusCounts, page } = await listAlerts({ status, page: rawPage });

  const FILTERS = [
    { value: "", label: `All (${statusCounts ? countAll(statusCounts) : 0})` },
    { value: "OPEN", label: `Open (${statusCounts?.OPEN ?? 0})` },
    {
      value: "ACKNOWLEDGED",
      label: `Acknowledged (${statusCounts?.ACKNOWLEDGED ?? 0})`,
    },
    { value: "RESOLVED", label: `Resolved (${statusCounts?.RESOLVED ?? 0})` },
  ];

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Emergencies, breakdowns and delays raised from the field. Nothing is deleted — every alert keeps its history."
        icon="alerts"
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Needs a response"
            value={statusCounts.OPEN}
            sub={statusCounts.OPEN > 0 ? "not yet acknowledged" : "all clear"}
            tone={statusCounts.OPEN > 0 ? "red" : "emerald"}
            icon="alert"
          />
          <StatTile
            label="Being handled"
            value={statusCounts.ACKNOWLEDGED}
            tone={statusCounts.ACKNOWLEDGED > 0 ? "amber" : "slate"}
            icon="clock"
          />
          <StatTile
            label="Resolved"
            value={statusCounts.RESOLVED}
            tone="emerald"
            icon="check"
          />
        </div>

        <Card>
          <CardTitle
            icon="alerts"
            hint={describeWindow(page)}
            action={
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <Link
                    key={f.value}
                    href={f.value ? `/admin/alerts?status=${f.value}` : "/admin/alerts"}
                    className={
                      (status ?? "") === f.value
                        ? "btn-primary px-2.5 py-1 text-xs"
                        : "btn-secondary px-2.5 py-1 text-xs"
                    }
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            }
          >
            Alert queue
          </CardTitle>

          {alerts.length === 0 ? (
            <EmptyState
              icon="alerts"
              title={status ? `No ${status.toLowerCase()} alerts` : "No alerts raised"}
              description={
                status
                  ? "Try the All filter to see the full history."
                  : "Drivers and students can raise these from their phones during a trip. Nothing here means a smooth run."
              }
            />
          ) : (
            <ul className="space-y-3">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`rounded-xl border p-4 ${
                    alert.status === "OPEN"
                      ? "border-red-200 bg-red-50/60"
                      : alert.status === "ACKNOWLEDGED"
                        ? "border-amber-200 bg-amber-50/40"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={STATUS_TONE[alert.status]}>
                          {alert.status.toLowerCase()}
                        </Badge>
                        <span className="text-sm font-semibold text-slate-900">
                          {TYPE_LABEL[alert.type] ?? alert.type}
                        </span>
                        <span className="text-xs text-slate-500">
                          raised by {alert.raisedBy?.name ?? "unknown"} ({alert.raisedBy?.role?.toLowerCase() ?? "?"})
                        </span>
                      </div>

                      <p className="mt-1.5 text-sm text-slate-800">{alert.message}</p>

                      <p className="mt-1.5 text-xs text-slate-500">
                        {formatDate(alert.createdAt)} at {formatTime(alert.createdAt)} (
                        {timeAgo(alert.createdAt)})
                        {alert.bus ? (
                          <>
                            {" · "}
                            <Link
                              href={`/admin/buses/${alert.bus.id}`}
                              className="text-brand-700 underline decoration-brand-400 underline-offset-2 hover:decoration-brand-700"
                            >
                              {alert.bus.busNumber}
                            </Link>
                            {alert.bus.route ? ` on ${alert.bus.route.name}` : ""}
                          </>
                        ) : null}
                        {alert.trip ? (
                          <>
                            {" · "}
                            <Link
                              href={`/admin/trips/${alert.trip.id}`}
                              className="text-brand-700 underline decoration-brand-400 underline-offset-2 hover:decoration-brand-700"
                            >
                              trip
                            </Link>
                          </>
                        ) : null}
                        {alert.lat != null && alert.lng != null ? (
                          <>
                            {" · "}
                            <span className="tabular-nums">
                              {alert.lat.toFixed(4)}, {alert.lng.toFixed(4)}
                            </span>
                          </>
                        ) : null}
                      </p>

                      {alert.resolvedAt ? (
                        <p className="mt-1.5 text-xs text-emerald-700">
                          resolved {timeAgo(alert.resolvedAt)}
                          {alert.resolvedBy ? ` by ${alert.resolvedBy.name}` : ""}
                          {alert.resolutionNote ? ` — "${alert.resolutionNote}"` : ""}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {alert.status === "OPEN" ? (
                        <ActionForm
                          action={acknowledgeAlert}
                          hidden={{ id: alert.id }}
                          label="Acknowledge"
                          className="btn-primary px-2.5 py-1 text-xs"
                          title="Records that an admin has seen this"
                        />
                      ) : null}

                      {alert.status !== "RESOLVED" ? (
                        <ActionForm
                          action={resolveAlert}
                          hidden={{ id: alert.id }}
                          label="Resolve"
                          className="btn-secondary px-2.5 py-1 text-xs"
                          confirm={`Mark this ${TYPE_LABEL[alert.type] ?? alert.type} alert as resolved?`}
                        />
                      ) : (
                        <ActionForm
                          action={reopenAlert}
                          hidden={{ id: alert.id }}
                          label="Reopen"
                          className="btn-ghost px-2.5 py-1 text-xs"
                          confirm="Reopen this alert? It goes back into the open queue."
                        />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Pagination page={page} basePath="/admin/alerts" params={{ status }} />
        </Card>
      </div>
    </>
  );
}
