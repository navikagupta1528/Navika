import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { getBusLoads } from "@/lib/admin/queries";
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
import { deleteBus, setBusStatus } from "@/app/actions/admin/buses";

const STATUS_TONE = {
  ACTIVE: "emerald",
  MAINTENANCE: "amber",
  INACTIVE: "slate",
} as const;

export default async function BusesPage() {
  await requireRole(Role.ADMIN);
  const buses = await getBusLoads();

  const overbooked = buses.filter((b) => b.overbooked);
  const totalSeats = buses.reduce((sum, b) => sum + b.capacity, 0);
  const totalEnrolled = buses.reduce((sum, b) => sum + b.enrolled, 0);

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Vehicles, their routes, and how full they are."
        action={
          <Link href="/admin/buses/new" className="btn-primary">
            New bus
          </Link>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Buses" value={buses.length} tone="blue" />
          <StatTile
            label="Seats vs enrolled"
            value={`${totalEnrolled}/${totalSeats}`}
            sub={
              totalSeats > 0
                ? `${Math.round((totalEnrolled / totalSeats) * 100)}% full`
                : "—"
            }
            tone={totalEnrolled > totalSeats ? "red" : "emerald"}
          />
          <StatTile
            label="Overbooked"
            value={overbooked.length}
            sub={overbooked.length > 0 ? "need attention" : "all within capacity"}
            tone={overbooked.length > 0 ? "red" : "emerald"}
          />
        </div>

        {overbooked.length > 0 ? (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 inset-ring-1 inset-ring-red-200">
            <p className="font-medium">Over capacity</p>
            <p className="mt-0.5 text-xs">
              {overbooked.map((b) => `${b.busNumber} (+${b.enrolled - b.capacity})`).join(", ")}.
              Move some students to another bus, or raise the capacity if the vehicle
              genuinely has more seats.
            </p>
          </div>
        ) : null}

        <Card>
          <CardTitle hint="Enrolment counts come from active assignments only.">
            All buses
          </CardTitle>

          <DataTable
            head={["Bus", "Registration", "Route", "Enrolled", "Status", ""]}
            empty={
              buses.length === 0 ? (
                <TableEmpty colSpan={6}>
                  No buses yet. Add one to start assigning students.
                </TableEmpty>
              ) : undefined
            }
          >
            {buses.map((bus) => (
              <Row key={bus.id}>
                <Cell>
                  <Link
                    href={`/admin/buses/${bus.id}`}
                    className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                  >
                    {bus.busNumber}
                  </Link>
                </Cell>
                <Cell className="font-mono text-xs text-slate-600">
                  {bus.registrationNo}
                </Cell>
                <Cell>
                  {bus.route ? (
                    <Link
                      href={`/admin/routes/${bus.route.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {bus.route.name}
                    </Link>
                  ) : (
                    <span className="text-amber-600">no route — cannot run</span>
                  )}
                </Cell>
                <Cell>
                  <span
                    className={
                      bus.overbooked
                        ? "font-semibold text-red-600 tabular-nums"
                        : "tabular-nums text-slate-700"
                    }
                  >
                    {bus.enrolled}
                  </span>
                  <span className="text-xs text-slate-400"> / {bus.capacity}</span>
                </Cell>
                <Cell>
                  <Badge tone={STATUS_TONE[bus.status]}>{bus.status.toLowerCase()}</Badge>
                </Cell>
                <RowActions>
                  {bus.status !== "ACTIVE" ? (
                    <ActionForm
                      action={setBusStatus}
                      hidden={{ id: bus.id, status: "ACTIVE" }}
                      label="Activate"
                      className="btn-ghost text-xs"
                    />
                  ) : (
                    <ActionForm
                      action={setBusStatus}
                      hidden={{ id: bus.id, status: "MAINTENANCE" }}
                      label="Maintenance"
                      className="btn-ghost text-xs"
                    />
                  )}
                  <ActionForm
                    action={deleteBus}
                    hidden={{ id: bus.id }}
                    label="Delete"
                    className="btn-ghost text-xs text-red-600"
                    confirm={`Delete bus ${bus.busNumber}? Only possible if it has never run a trip and has no students.`}
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
