import type { ReactNode } from "react";

/**
 * A field on an admin form.
 *
 * The admin screens are all "a list plus a create form plus an edit form", so
 * rather than hand-writing each input five times, every form is described as
 * data and rendered by `EntityForm`. Adding a field to, say, the bus form is
 * then a one-line change in `src/lib/admin/schemas.ts`.
 */
export type FieldOption = { value: string; label: string; disabled?: boolean };

type Base = {
  name: string;
  label: string;
  required?: boolean;
  help?: string;
  placeholder?: string;
};

export type Field =
  | (Base & {
      kind: "text" | "email" | "password" | "date" | "time" | "datetime-local" | "number";
      defaultValue?: string;
      min?: number | string;
      max?: number | string;
      step?: number | string;
      autoComplete?: string;
      readOnly?: boolean;
    })
  | (Base & {
      kind: "select";
      options: FieldOption[];
      defaultValue?: string;
      emptyLabel?: string;
    })
  | (Base & {
      kind: "textarea";
      defaultValue?: string;
      rows?: number;
    })
  | (Base & { kind: "checkbox"; defaultChecked?: boolean });

export function defaultFieldValues(fields: Field[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.kind === "checkbox") continue;
    out[f.name] = f.defaultValue ?? "";
  }
  return out;
}

export function defaultCheckboxValues(fields: Field[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of fields) {
    if (f.kind === "checkbox") out[f.name] = f.defaultChecked ?? false;
  }
  return out;
}

/** Read a FormData into the plain shape EntityForm wants to render back. */
export function readForm(formData: FormData, fields: Field[]) {
  const values: Record<string, string> = {};
  const checked: Record<string, boolean> = {};
  for (const f of fields) {
    if (f.kind === "checkbox") {
      checked[f.name] = formData.get(f.name) === "on" || formData.get(f.name) === "true";
    } else {
      const raw = formData.get(f.name);
      values[f.name] = typeof raw === "string" ? raw : "";
    }
  }
  return { values, checked };
}

/** Shared wrapper so list pages and forms look the same everywhere. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
