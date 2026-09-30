"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { Field } from "@/lib/admin/fields";
import type { ActionState } from "@/lib/admin/action-state";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** A Server Action that takes only the form and cannot report field errors. */
type PlainAction = (formData: FormData) => Promise<void>;

const GRID_CLASSES: Record<number, string> = {
  1: "space-y-4",
  2: "grid gap-4 sm:grid-cols-2",
  3: "grid gap-4 sm:grid-cols-3",
};

function SubmitRow({ label, children }: { label: string; children?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      {children}
    </div>
  );
}

function FieldShell({
  field,
  error,
  children,
}: {
  field: Field;
  error?: string;
  children: React.ReactNode;
}) {
  const errorId = `${field.name}-error`;
  const helpId = `${field.name}-help`;
  return (
    <div>
      <label className="label" htmlFor={field.name}>
        {field.label}
        {field.required ? (
          <span className="ml-0.5 text-red-500" aria-hidden>
            *
          </span>
        ) : (
          <span className="ml-1 font-normal text-slate-400">(optional)</span>
        )}
      </label>
      {children}
      {field.help ? (
        <p id={helpId} className="mt-1 text-xs text-slate-500">
          {field.help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describe(field: Field, error?: string) {
  const ids = [field.help ? `${field.name}-help` : null, error ? `${field.name}-error` : null]
    .filter(Boolean)
    .join(" ");
  return ids ? { "aria-describedby": ids } : {};
}

function renderField(field: Field) {
  switch (field.kind) {
    case "checkbox":
      return (
        <label className="flex items-start gap-2.5 pt-1">
          <input
            id={field.name}
            name={field.name}
            type="checkbox"
            defaultChecked={field.defaultChecked}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500/30"
          />
          <span className="text-sm text-slate-700">
            {field.label}
            {field.help ? (
              <span className="mt-0.5 block text-xs text-slate-500">{field.help}</span>
            ) : null}
          </span>
        </label>
      );

    case "select":
      return (
        <select
          id={field.name}
          name={field.name}
          defaultValue={field.defaultValue ?? ""}
          className="field"
          {...describe(field)}
        >
          <option value="">{field.emptyLabel ?? `Select ${field.label.toLowerCase()}`}</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "textarea":
      return (
        <textarea
          id={field.name}
          name={field.name}
          rows={field.rows ?? 3}
          defaultValue={field.defaultValue ?? ""}
          placeholder={field.placeholder}
          className="field"
          {...describe(field)}
        />
      );

    default:
      return (
        <input
          id={field.name}
          name={field.name}
          type={field.kind}
          defaultValue={field.defaultValue ?? ""}
          placeholder={field.placeholder}
          required={field.required}
          readOnly={field.readOnly}
          autoComplete={field.autoComplete}
          min={field.min}
          max={field.max}
          step={field.step}
          className="field"
          {...describe(field)}
        />
      );
  }
}

type SharedProps = {
  fields: Field[];
  submitLabel?: string;
  columns?: 1 | 2 | 3;
  hidden?: Record<string, string>;
  cancelHref?: string;
};

function HiddenFields({ hidden }: { hidden?: Record<string, string> }) {
  if (!hidden) return null;
  return (
    <>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

function FieldGrid({
  fields,
  columns,
  errors,
}: {
  fields: Field[];
  columns: number;
  errors?: Record<string, string | undefined>;
}) {
  return (
    <div className={GRID_CLASSES[columns]}>
      {fields.map((field) => (
        <div
          key={field.name}
          className={
            field.kind === "checkbox" || field.kind === "textarea"
              ? "sm:col-span-2"
              : undefined
          }
        >
          <FieldShell field={field} error={errors?.[field.name]}>
            {renderField(field)}
          </FieldShell>
        </div>
      ))}
    </div>
  );
}

function CancelLink({ href }: { href?: string }) {
  if (!href) return null;
  return (
    <a href={href} className="btn-ghost">
      Cancel
    </a>
  );
}

/**
 * Renders an admin form from a field list, with validation errors.
 *
 * Use this when the Server Action can reject the input and needs to say why:
 * it takes the `(state, formData)` shape that `useActionState` expects, so the
 * message appears next to the field instead of replacing the page.
 */
export function EntityForm({
  fields,
  action,
  submitLabel = "Save",
  columns = 2,
  hidden,
  cancelHref,
}: SharedProps & { action: Action }) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <HiddenFields hidden={hidden} />

      {state?.message ? (
        <p className="alert-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <FieldGrid fields={fields} columns={columns} errors={state?.errors} />

      <SubmitRow label={submitLabel}>
        <CancelLink href={cancelHref} />
      </SubmitRow>
    </form>
  );
}

/**
 * The same form, for a Server Action that cannot fail with a message.
 *
 * Assigning a driver or swapping a trip's driver either works or throws; there
 * is no field-level problem worth rendering, so this skips `useActionState` and
 * hands the action straight to `<form>`, which keeps one less client hook on
 * the page.
 */
export function QuickForm({
  fields,
  action,
  submitLabel = "Save",
  columns = 2,
  hidden,
  cancelHref,
}: SharedProps & { action: PlainAction }) {
  return (
    <form action={action} className="space-y-4">
      <HiddenFields hidden={hidden} />
      <FieldGrid fields={fields} columns={columns} />
      <SubmitRow label={submitLabel}>
        <CancelLink href={cancelHref} />
      </SubmitRow>
    </form>
  );
}

