import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle } from "@/components/ui/primitives";
import { EntityForm } from "@/components/admin/entity-form";
import { stopFields } from "@/lib/admin/form-defs";
import { saveStop } from "@/app/actions/admin/stops";

export default function NewStopPage() {
  return (
    <>
      <PageHeader
        title="New stop"
        description="A pickup point students can be assigned to."
        action={
          <Link href="/admin/stops" className="btn-secondary">
            Back to stops
          </Link>
        }
      />

      <div className="max-w-3xl">
        <Card>
          <CardTitle hint="Latitude and longitude decide where the map draws it.">
            Stop details
          </CardTitle>
          <EntityForm
            fields={stopFields}
            action={saveStop}
            submitLabel="Create stop"
            cancelHref="/admin/stops"
          />
        </Card>

        <p className="mt-4 text-xs text-slate-500">
          Tip: open OpenStreetMap, right-click the exact spot and copy the numbers
          after <code className="code-inline">lat=</code> and{" "}
          <code className="code-inline">#map=</code>. A stop off by
          100&nbsp;m makes every ETA wrong.
        </p>
      </div>
    </>
  );
}
