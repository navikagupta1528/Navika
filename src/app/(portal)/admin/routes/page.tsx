import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listRoutes } from "@/lib/admin/queries";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle, Badge } from "@/components/ui/primitives";
import {
  DataTable,
  Row,
  Cell,
  RowActions,
  TableEmpty,
} from "@/components/admin/data-table";
import { ActionForm } from "@/components/admin/action-form";
import { deleteRoute, toggleRouteActive } from "@/app/actions/admin/routes";

export default async function RoutesPage() {
  await requireRole(Role.ADMIN);
  const routes = await listRoutes();

  return (
    <>
      <PageHeader
        title="Routes"
        description="Each route is an ordered list of stops, shared by the buses assigned to it."
        icon="routes"
        action={
          <Link href="/admin/routes/new" className="btn-primary">
            New route
          </Link>
        }
      />

      <Card>
        <CardTitle
          icon="routes"
          hint={`${routes.length} route${routes.length === 1 ? "" : "s"}`}
        >
          All routes
        </CardTitle>

        <DataTable
          head={["Route", "Code", "Stops", "Buses", "Trips", "Status", ""]}
          empty={
            routes.length === 0 ? (
              <TableEmpty colSpan={7}>No routes yet.</TableEmpty>
            ) : undefined
          }
        >
          {routes.map((route) => (
            <Row key={route.id}>
              <Cell>
                <Link
                  href={`/admin/routes/${route.id}`}
                  className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                >
                  {route.name}
                </Link>
                {route.description ? (
                  <p className="text-xs text-slate-500">{route.description}</p>
                ) : null}
              </Cell>
              <Cell className="font-mono text-xs text-slate-600">
                {route.code}
              </Cell>
              <Cell className="tabular-nums text-slate-600">
                {route._count.routeStops}
              </Cell>
              <Cell className="tabular-nums text-slate-600">
                {route._count.buses}
              </Cell>
              <Cell className="tabular-nums text-slate-600">
                {route._count.trips}
              </Cell>
              <Cell>
                {route.isActive ? (
                  <Badge tone="emerald">active</Badge>
                ) : (
                  <Badge tone="slate">inactive</Badge>
                )}
              </Cell>
              <RowActions>
                <ActionForm
                  action={toggleRouteActive}
                  hidden={{ id: route.id, next: String(!route.isActive) }}
                  label={route.isActive ? "Deactivate" : "Activate"}
                  className="btn-ghost text-xs"
                />
                <ActionForm
                  action={deleteRoute}
                  hidden={{ id: route.id }}
                  label="Delete"
                  className="btn-ghost text-xs text-red-600"
                  confirm={`Delete "${route.name}"? Only possible if no bus or trip uses it.`}
                />
              </RowActions>
            </Row>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
