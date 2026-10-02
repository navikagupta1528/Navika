"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toggleSimulation, type SimulationResult } from "@/app/actions/admin/simulator";

/**
 * The start/stop control for a simulated bus.
 *
 * Separate from `ActionForm` because it has to report a *result*: starting a bus
 * that has no route fails, and "nothing appeared to happen" would be a worse
 * outcome than a sentence explaining why. `ActionForm` is for actions that either
 * work or throw.
 */
export function SimulationToggle({
  busId,
  running,
  hasRoute,
}: {
  busId: string;
  /** Whether this process is currently driving the bus. */
  running: boolean;
  /** Whether the bus has a route with at least two stops. */
  hasRoute: boolean;
}) {
  const [state, formAction] = useActionState<SimulationResult | null, FormData>(
    toggleSimulation,
    null,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="busId" value={busId} />
      <SubmitButton running={running} disabled={!hasRoute} />

      {/*
        role="status" rather than an aria-live attribute on a wrapper: the button
        is already focusable, and an assertive announcement on every tick of a
        simulation would be noise for a screen reader user.
      */}
      <p role="status" className="min-h-4 text-xs">
        {state?.ok ? (
          <span className="text-emerald-700">{state.message}</span>
        ) : state?.error ? (
          <span className="text-red-700">{state.error}</span>
        ) : null}
      </p>

      {!hasRoute ? (
        <p className="text-xs text-slate-500">
          This bus needs a route with at least two stops before it can be driven.
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton({ running, disabled }: { running: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={running ? "btn-ghost px-2 py-1 text-xs" : "btn-secondary px-2 py-1 text-xs"}
      title={
        running
          ? "Stop driving this bus along its route"
          : "Drive this bus along its route with no driver"
      }
    >
      {pending ? "Working…" : running ? "Stop simulation" : "Simulate route"}
    </button>
  );
}