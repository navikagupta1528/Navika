"use client";

import { useFormStatus } from "react-dom";

type Action = (formData: FormData) => Promise<void> | void;

function Button({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * A one-button form for row actions: delete, activate, deactivate, start trip.
 *
 * Destructive rows pass `confirm`, which blocks the submit until the admin
 * acknowledges it. That is a deliberate step back from `window.confirm` — the
 * native dialog cannot be styled and reads as a browser error on Windows.
 */
export function ActionForm({
  action,
  hidden,
  label,
  pendingLabel,
  className = "btn-secondary",
  confirm,
  title,
  ariaLabel,
}: {
  action: Action;
  hidden?: Record<string, string>;
  label: string;
  pendingLabel?: string;
  className?: string;
  confirm?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <form
      action={action}
      title={title}
      aria-label={ariaLabel ?? label}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
        }
      }}
    >
      {hidden
        ? Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))
        : null}
      <Button
        label={label}
        pendingLabel={pendingLabel ?? "…"}
        className={className}
      />
    </form>
  );
}
