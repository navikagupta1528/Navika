import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Card, CardTitle } from "@/components/ui/primitives";
import { EntityForm } from "@/components/admin/entity-form";
import { driverFields, driverActiveField } from "@/lib/admin/form-defs";
import { createDriver } from "@/app/actions/admin/drivers";

export default function NewDriverPage() {
  return (
    <>
      <PageHeader
        title="New driver"
        description="Creates the login the driver uses on their phone, plus the licence record."
        action={
          <Link href="/admin/drivers" className="btn-secondary">
            Back to drivers
          </Link>
        }
      />

      <div className="max-w-3xl">
        <Card>
          <CardTitle hint="Drivers cannot sign themselves up; this is the only way in.">
            Driver details
          </CardTitle>
          <EntityForm
            fields={[
              ...driverFields,
              {
                ...driverActiveField,
                help: "Leave ticked so the driver can sign in immediately.",
              },
            ]}
            action={createDriver}
            submitLabel="Create driver"
            cancelHref="/admin/drivers"
          />
        </Card>

        <p className="mt-4 text-xs text-slate-500">
          Share the password with the driver over a channel you trust, and ask them to
          change it. There is no self-service password reset yet.
        </p>
      </div>
    </>
  );
}
