import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle } from "@/components/ui/primitives";
import { EntityForm } from "@/components/admin/entity-form";
import { routeFields } from "@/lib/admin/form-defs";
import { saveRoute } from "@/app/actions/admin/routes";

export default function NewRoutePage() {
  return (
    <>
      <PageHeader
        title="New route"
        description="A named sequence of stops that a bus runs."
        icon="routes"
        action={
          <Link href="/admin/routes" className="btn-secondary">
            Back to routes
          </Link>
        }
      />

      <div className="max-w-3xl">
        <Card>
          <CardTitle
            icon="routes"
            size="md"
            hint="Add the stops to the sequence after creating the route."
          >
            Route details
          </CardTitle>
          <EntityForm
            fields={routeFields}
            action={saveRoute}
            submitLabel="Create route"
            cancelHref="/admin/routes"
          />
        </Card>
      </div>
    </>
  );
}
