import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getStop } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge, EmptyState } from "@/components/ui/primitives";
import { DetailList } from "@/components/admin/data-table";
import { EntityForm } from "@/components/admin/entity-form";
import { stopDefaults } from "@/lib/admin/form-defs";
import { deleteStop, saveStop, toggleStopActive } from "@/app/actions/admin/stops";
import { ActionForm } from "@/components/admin/action-form";
import { RouteMap } from "@/components/map/route-map";
import { formatDate } from "@/lib/utils";

export default async function StopDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { id } = await params;
  const stop = await getStop(id);
  if (!stop) notFound();

  return (
    <>
      <PageHeader
        title={stop.name}
        description={stop.address ?? "No address recorded"}
        action={
          <Link href="/admin/stops" className="btn-secondary">
            Back to stops
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardTitle hint="The pin the driver sees on the pickup sheet.">
              Location
            </CardTitle>
            <RouteMap
              height="18rem"
              stops={[
                {
                  id: stop.id,
                  name: stop.name,
                  lat: stop.lat,
                  lng: stop.lng,
                  order: 1,
                  isActive: stop.isActive,
                  detail: stop.address,
                },
              ]}
              fallbackViewport={{ center: { lat: stop.lat, lng: stop.lng }, zoom: 15 }}
              emptyMessage="This stop has no coordinates yet. Add them in the form below."
            />
            <p className="mt-2 text-xs text-slate-500">
              {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)} — a stop placed in the wrong
              spot sends every student to the wrong junction, so check this against the
              road rather than trusting the address.
            </p>
          </Card>

          <Card>
            <CardTitle hint="Changes take effect on the next scheduled trip.">
              Edit stop
            </CardTitle>
            <EntityForm
              fields={stopDefaults(stop)}
              action={saveStop}
              submitLabel="Save changes"
              hidden={{ id: stop.id }}
              cancelHref="/admin/stops"
            />
          </Card>

          <Card>
            <CardTitle
              hint="Students currently assigned here"
              action={<Badge tone="blue">{stop.enrollmentCount}</Badge>}
            >
              Enrolments at this stop
            </CardTitle>

            {stop.enrollments.length === 0 ? (
              <EmptyState
                title="Nobody assigned yet"
                description="Assign students from the Students screen, picking this stop as their pickup point."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {stop.enrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium text-slate-900">
                        {e.student.user.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {e.student.enrollmentNo} · {e.academicYear}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={e.direction === "PICKUP" ? "blue" : "violet"}>
                        {e.direction === "PICKUP" ? "to college" : "to home"}
                      </Badge>
                      {!e.isActive ? <Badge tone="slate">inactive</Badge> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Details</CardTitle>
            <DetailList
              items={[
                {
                  label: "Status",
                  value: stop.isActive ? (
                    <Badge tone="emerald">active</Badge>
                  ) : (
                    <Badge tone="slate">inactive</Badge>
                  ),
                },
                { label: "Latitude", value: stop.lat.toFixed(6) },
                { label: "Longitude", value: stop.lng.toFixed(6) },
                { label: "Created", value: formatDate(stop.createdAt) },
                {
                  label: "Last edited",
                  value: formatDate(stop.updatedAt),
                },
              ]}
            />
          </Card>

          <Card>
            <CardTitle hint="Used by these routes">On routes</CardTitle>
            {stop.routes.length === 0 ? (
              <p className="text-sm text-slate-500">
                Not on any route yet, so no bus will stop here.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {stop.routes.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <Link
                      href={`/admin/routes/${r.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="text-xs text-slate-500">
                      stop {r.stopOrder}
                      {r.scheduledHHMM ? ` · ${r.scheduledHHMM}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Danger zone</CardTitle>
            <p className="mb-3 text-xs text-slate-500">
              Deactivating keeps past trips readable and stops new enrolments.
              Deleting is only possible once nothing references this stop.
            </p>
            <ActionForm
              action={toggleStopActive}
              hidden={{ id: stop.id, next: String(!stop.isActive) }}
              label={stop.isActive ? "Deactivate stop" : "Reactivate stop"}
              className="btn-secondary w-full"
            />

            <div className="mt-4 border-t border-slate-200 pt-4">
              {stop.deletable ? (
                <>
                  <p className="mb-2 text-xs text-slate-500">
                    Nothing references this stop, so it can be removed outright.
                  </p>
                  <ActionForm
                    action={deleteStop}
                    hidden={{ id: stop.id }}
                    label="Delete stop permanently"
                    className="btn-danger w-full"
                    confirm={`Delete "${stop.name}" for good? There is no history to keep, but the row cannot be recovered.`}
                  />
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Delete is unavailable while this stop is in use — currently{" "}
                  {stop.blockers.join(", ")}. Deactivate it instead: the history stays
                  readable and it drops out of the pick-up dropdowns.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
