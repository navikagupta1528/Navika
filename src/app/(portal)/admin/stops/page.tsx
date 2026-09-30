import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listStops } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge } from "@/components/ui/primitives";
import { DataTable, Row, Cell, RowActions, TableEmpty } from "@/components/admin/data-table";
import { ActionForm } from "@/components/admin/action-form";
import { deleteStop, toggleStopActive } from "@/app/actions/admin/stops";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Stops" };

export default async function StopsPage() {
  await requireRole(Role.ADMIN);
  const stops = await listStops();

  return (
    <>
      <PageHeader
        title="Stops"
        description="Pickup points. Coordinates drive the map and the ETA, so drop a pin rather than guessing."
        action={
          <Link href="/admin/stops/new" className="btn-primary">
            New stop
          </Link>
        }
      />

      <Card>
        <CardTitle
          hint={`${stops.length} stop${stops.length === 1 ? "" : "s"} · ${
            stops.filter((s) => !s.isActive).length
          } inactive`}
        >
          All stops
        </CardTitle>

        <DataTable
          head={["Name", "Address", "Coordinates", "Routes", "Status", ""]}
          empty={
            stops.length === 0 ? (
              <TableEmpty colSpan={6}>
                No stops yet. Create one before adding routes.
              </TableEmpty>
            ) : undefined
          }
        >
          {stops.map((stop) => (
            <Row key={stop.id}>
              <Cell>
                <Link
                  href={`/admin/stops/${stop.id}`}
                  className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                >
                  {stop.name}
                </Link>
              </Cell>
              <Cell className="text-slate-600">{stop.address ?? "—"}</Cell>
              <Cell className="tabular-nums text-slate-600">
                {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
              </Cell>
              <Cell className="text-slate-600">
                {stop.routeCount > 0 ? (
                  <Badge tone="blue">{stop.routeCount} route{stop.routeCount === 1 ? "" : "s"}</Badge>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </Cell>
              <Cell>
                {stop.isActive ? (
                  <Badge tone="emerald">active</Badge>
                ) : (
                  <Badge tone="slate">inactive</Badge>
                )}
              </Cell>
              <RowActions>
                <ActionForm
                  action={toggleStopActive}
                  hidden={{ id: stop.id, next: String(!stop.isActive) }}
                  label={stop.isActive ? "Deactivate" : "Activate"}
                  className="btn-ghost text-xs"
                />
                <ActionForm
                  action={deleteStop}
                  hidden={{ id: stop.id }}
                  label="Delete"
                  className="btn-ghost text-xs text-red-600"
                  confirm={`Delete "${stop.name}"? Only possible if no route, enrolment or trip uses it.`}
                  title={`Added ${formatDate(stop.createdAt)}`}
                />
              </RowActions>
            </Row>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
