import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getDriver, listDrivers } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, EmptyState } from "@/components/ui/primitives";
import { DetailList } from "@/components/admin/data-table";
import { EntityForm } from "@/components/admin/entity-form";
import { ActionForm } from "@/components/admin/action-form";
import { driverDefaults, driverActiveField } from "@/lib/admin/form-defs";
import { createDriver, toggleDriverActive, deleteDriver } from "@/app/actions/admin/drivers";
import { formatDate } from "@/lib/utils";

export default async function DriverDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { id } = await params;
  const [driver, all] = await Promise.all([getDriver(id), listDrivers()]);
  if (!driver || driver.role !== "DRIVER") notFound();

  const summary = all.find((d) => d.id === driver.id);
  const active = driver.busAssignments.filter((a) => a.validTo == null);
  const past = driver.busAssignments.filter((a) => a.validTo != null);

  return (
    <>
      <PageHeader
        title={driver.name}
        description={driver.email}
        icon="drivers"
        action={
          <Link href="/admin/drivers" className="btn-secondary">
            Back to drivers
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardTitle
              icon="drivers"
              hint="Leave the password blank to keep the current one."
            >
              Driver details
            </CardTitle>
            <EntityForm
              fields={[
                ...driverDefaults({
                  name: driver.name,
                  email: driver.email,
                  phone: driver.phone,
                  isActive: driver.isActive,
                  driverProfile: driver.driverProfile,
                }),
                { ...driverActiveField, defaultChecked: driver.isActive },
              ]}
              action={createDriver}
              submitLabel="Save driver"
              hidden={{ id: driver.id }}
              cancelHref="/admin/drivers"
            />
          </Card>

          <Card>
            <CardTitle hint="Assign buses from the Fleet screen.">Bus assignments</CardTitle>
            {active.length === 0 && past.length === 0 ? (
              <EmptyState
                icon="fleet"
                title="No bus assignments"
                description="Open the bus and assign this driver, so trips can be scheduled for them."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {[...active, ...past].map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="flex items-center gap-2 font-medium text-slate-900">
                        <Link
                          href={`/admin/buses/${a.bus.id}`}
                          className="text-brand-700 hover:underline"
                        >
                          {a.bus.busNumber}
                        </Link>
                        <span className="text-xs font-normal text-slate-500">
                          {a.bus.registrationNo}
                        </span>
                        {a.isPrimary ? <Badge tone="blue">primary</Badge> : null}
                        {a.validTo ? <Badge tone="slate">ended</Badge> : <Badge tone="emerald">current</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(a.validFrom)} → {a.validTo ? formatDate(a.validTo) : "now"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle icon="overview">Summary</CardTitle>
            <DetailList
              items={[
                {
                  label: "Status",
                  value: driver.isActive ? (
                    <Badge tone="emerald">active</Badge>
                  ) : (
                    <Badge tone="slate">inactive</Badge>
                  ),
                },
                { label: "Phone", value: driver.phone ?? "—" },
                {
                  label: "Licence",
                  value: (
                    <span className="font-mono text-xs">
                      {driver.driverProfile?.licenseNo ?? "—"}
                    </span>
                  ),
                },
                {
                  label: "Licence valid to",
                  value: summary?.licenseExpired ? (
                    <span className="font-medium text-red-600">
                      expired {formatDate(driver.driverProfile?.licenseExpiry ?? null)}
                    </span>
                  ) : (
                    formatDate(driver.driverProfile?.licenseExpiry ?? null)
                  ),
                },
                {
                  label: "Experience",
                  value: `${driver.driverProfile?.experienceYr ?? 0} years`,
                },
                { label: "Trips driven", value: driver._count.drivenTrips },
                { label: "Joined", value: formatDate(driver.createdAt) },
              ]}
            />
          </Card>

          <Card>
            <CardTitle icon="shield">Access</CardTitle>
            <p className="mb-3 text-xs text-slate-500">
              An inactive driver cannot sign in, and cannot be assigned to a new trip.
              Deactivating is refused while a bus assignment is open.
            </p>
            <ActionForm
              action={toggleDriverActive}
              hidden={{ id: driver.id, next: String(!driver.isActive) }}
              label={driver.isActive ? "Deactivate account" : "Reactivate account"}
              className="btn-secondary w-full"
            />
          </Card>

          <Card accent="red">
            <CardTitle icon="alert" tone="red">
              Danger zone
            </CardTitle>
            {driver._count.drivenTrips === 0 ? (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  This driver has never been assigned a trip, so the account and its
                  licence record can be removed.
                </p>
                <ActionForm
                  action={deleteDriver}
                  hidden={{ id: driver.id }}
                  label="Delete driver permanently"
                  className="btn-danger w-full"
                  confirm={`Delete ${driver.name}? This removes their sign-in and licence record. It cannot be undone.`}
                />
              </>
            ) : (
              <p className="text-xs text-slate-500">
                Delete is unavailable: this driver has{" "}
                {driver._count.drivenTrips} trip(s) on record, and every one of them
                names them as the person who drove. Deactivate the account instead.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
