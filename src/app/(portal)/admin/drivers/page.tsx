import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listDrivers } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, StatTile } from "@/components/ui/primitives";
import {
  DataTable,
  Row,
  Cell,
  RowActions,
  TableEmpty,
} from "@/components/admin/data-table";
import { ActionForm } from "@/components/admin/action-form";
import {
  deleteDriver,
  toggleDriverActive,
} from "@/app/actions/admin/drivers";
import { formatDate } from "@/lib/utils";

export default async function DriversPage() {
  await requireRole(Role.ADMIN);
  const drivers = await listDrivers();

  const active = drivers.filter((d) => d.isActive);
  const unassigned = active.filter((d) => d.buses.length === 0);
  const expiring = active.filter((d) => d.licenseExpired);
  const soon = active.filter(
    (d) => d.licenseDaysLeft != null && d.licenseDaysLeft > 0 && d.licenseDaysLeft <= 60,
  );
  /** Expired, or expiring soon — the two that need a phone call. */
  const needsAttention = drivers.filter(
    (d) => d.licenseExpired || soon.some((s) => s.id === d.id),
  );

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Driver accounts, licences and which bus each one is on."
        action={
          <Link href="/admin/drivers/new" className="btn-primary">
            New driver
          </Link>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Active drivers" value={active.length} tone="blue" />
          <StatTile
            label="Unassigned"
            value={unassigned.length}
            sub={unassigned.length > 0 ? "no bus yet" : "all have a bus"}
            tone={unassigned.length > 0 ? "amber" : "emerald"}
          />
          <StatTile
            label="Licence expired"
            value={expiring.length}
            tone={expiring.length > 0 ? "red" : "emerald"}
          />
          <StatTile
            label="Expiring in 60 days"
            value={soon.length}
            tone={soon.length > 0 ? "amber" : "slate"}
          />
        </div>

        {expiring.length > 0 || soon.length > 0 ? (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 inset-ring-1 inset-ring-amber-200">
            <p className="font-medium">Licences need attention</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {needsAttention.map((d) => (
                <li key={d.id}>
                  {d.name} — {d.licenseExpired ? "expired" : "expiring"}{" "}
                  {formatDate(d.profile?.licenseExpiry ?? null)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Card>
          <CardTitle hint={`${drivers.length} driver account${drivers.length === 1 ? "" : "s"}`}>
            All drivers
          </CardTitle>

          <DataTable
            head={["Driver", "Contact", "Licence", "Experience", "Bus", "Status", ""]}
            empty={
              drivers.length === 0 ? (
                <TableEmpty colSpan={7}>
                  No drivers yet. Drivers cannot self-register — create them here.
                </TableEmpty>
              ) : undefined
            }
          >
            {drivers.map((driver) => (
              <Row key={driver.id}>
                <Cell>
                  <Link
                    href={`/admin/drivers/${driver.id}`}
                    className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                  >
                    {driver.name}
                  </Link>
                  <p className="text-xs text-slate-500">{driver.email}</p>
                </Cell>
                <Cell className="text-slate-600">{driver.phone ?? "—"}</Cell>
                <Cell>
                  {driver.profile ? (
                    <span className="text-xs">
                      <span className="font-mono text-slate-700">
                        {driver.profile.licenseNo}
                      </span>
                      <br />
                      <span
                        className={
                          driver.licenseExpired
                            ? "font-medium text-red-600"
                            : soon.some((s) => s.id === driver.id)
                              ? "text-amber-700"
                              : "text-slate-500"
                        }
                      >
                        {driver.licenseExpired ? "expired " : "valid to "}
                        {formatDate(driver.profile.licenseExpiry)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-amber-700">no profile</span>
                  )}
                </Cell>
                <Cell className="tabular-nums text-slate-600">
                  {driver.profile?.experienceYr ?? 0} yr
                </Cell>
                <Cell>
                  {driver.buses.length === 0 ? (
                    <span className="text-xs text-slate-500">unassigned</span>
                  ) : (
                    driver.buses.map((b) => (
                      <Link
                        key={b.bus.id}
                        href={`/admin/buses/${b.bus.id}`}
                        className="mr-1 text-xs text-brand-700 hover:underline"
                      >
                        {b.bus.busNumber}
                        {b.isPrimary ? " ★" : ""}
                      </Link>
                    ))
                  )}
                </Cell>
                <Cell>
                  {driver.isActive ? (
                    <Badge tone="emerald">active</Badge>
                  ) : (
                    <Badge tone="slate">inactive</Badge>
                  )}
                </Cell>
                <RowActions>
                  <ActionForm
                    action={toggleDriverActive}
                    hidden={{ id: driver.id, next: String(!driver.isActive) }}
                    label={driver.isActive ? "Deactivate" : "Activate"}
                    className="btn-ghost text-xs"
                  />
                  <ActionForm
                    action={deleteDriver}
                    hidden={{ id: driver.id }}
                    label="Delete"
                    className="btn-ghost text-xs text-red-600"
                    confirm={`Delete ${driver.name}? Only possible if they have never driven a trip.`}
                  />
                </RowActions>
              </Row>
            ))}
          </DataTable>
        </Card>
      </div>
    </>
  );
}
