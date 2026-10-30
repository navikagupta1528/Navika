import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle } from "@/components/ui/primitives";
import { EntityForm } from "@/components/admin/entity-form";
import { busFields, busStatusOptions } from "@/lib/admin/form-defs";
import { saveBus } from "@/app/actions/admin/buses";

export default async function NewBusPage({
  searchParams,
}: {
  searchParams: Promise<{ routeId?: string }>;
}) {
  const { routeId } = await searchParams;
  const { listRoutes } = await import("@/lib/admin/queries");
  const routes = await listRoutes();

  const fields = busFields.map((f) =>
    f.name === "routeId"
      ? {
          ...f,
          kind: "select" as const,
          options: routes
            .filter((r) => r.isActive)
            .map((r) => ({ value: r.id, label: `${r.name} (${r.code})` })),
          defaultValue: routeId ?? "",
        }
      : f,
  );

  return (
    <>
      <PageHeader
        title="New bus"
        description="Add a vehicle to the fleet and put it on a route."
        icon="fleet"
        action={
          <Link href="/admin/buses" className="btn-secondary">
            Back to fleet
          </Link>
        }
      />

      <div className="max-w-3xl">
        <Card>
          <CardTitle
            icon="fleet"
            size="md"
            hint="A bus needs a route with at least one stop before it can run trips."
          >
            Bus details
          </CardTitle>
          <EntityForm
            fields={fields}
            action={saveBus}
            submitLabel="Create bus"
            hidden={{ status: "ACTIVE" }}
            cancelHref="/admin/buses"
          />
        </Card>

        <fieldset className="hidden" aria-hidden>
          <legend className="sr-only">Initial status</legend>
          {busStatusOptions.map((o) => (
            <input key={o.value} type="hidden" name="status" value={o.value} />
          ))}
        </fieldset>
      </div>
    </>
  );
}
