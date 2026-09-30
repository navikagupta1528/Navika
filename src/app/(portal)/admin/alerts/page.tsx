import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listAlerts } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
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
  searchParams: Promise<{ status?: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { status } = await searchParams;

  const all = await listAlerts();
  const alerts = status
    ? all.filter((a) => a.status === status.toUpperCase())
    : all;

  const open = all.filter((a) => a.status === "OPEN");
  const acknowledged = all.filter((a) => a.status === "ACKNOWLEDGED");
  const resolved = all.filter((a) => a.status === "RESOLVED");

  const FILTERS = [
    { value: "", label: `All (${all.length})` },
    { value: "OPEN", label: `Open (${open.length})` },
    { value: "ACKNOWLEDGED", label: `Acknowledged (${acknowledged.length})` },
    { value: "RESOLVED", label: `Resolved (${resolved.length})` },
  ];

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Emergencies, breakdowns and delays raised from the field. Nothing is deleted — every alert keeps its history."
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Needs a response"
            value={open.length}
            sub={open.length > 0 ? "not yet acknowledged" : "all clear"}
            tone={open.length > 0 ? "red" : "emerald"}
          />
          <StatTile
            label="Being handled"
            value={acknowledged.length}
            tone={acknowledged.length > 0 ? "amber" : "slate"}
          />
          <StatTile label="Resolved" value={resolved.length} tone="emerald" />
        </div>

        <Card>
          <CardTitle
            hint="Newest first, most recent 100."
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
                              className="text-brand-700 hover:underline"
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
                              className="text-brand-700 hover:underline"
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
        </Card>
      </div>
    </>
  );
}
