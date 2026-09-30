"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/admin/action-state";

type BusOption = {
  id: string;
  label: string;
  capacity: number;
  stops: { id: string; label: string; disabled: boolean }[];
  hasRoute: boolean;
};

type Props = {
  students: { id: string; label: string; disabled: boolean }[];
  buses: BusOption[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultValues?: { id?: string; studentId?: string; busId?: string; stopId?: string; direction?: string; academicYear?: string };
  academicYears: string[];
  directionOptions: { value: string; label: string }[];
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save assignment"}
    </button>
  );
}

/**
 * The enrolment form, with a dependent stop list.
 *
 * The stop dropdown only offers stops on the selected bus's route. This is the
 * one place in the admin UI where a field genuinely depends on another, and
 * hiding impossible choices here saves the Server Action from having to reject
 * them (it still validates, because the client is not a trust boundary).
 */
export function EnrollForm({ students, buses, action, defaultValues, academicYears, directionOptions }: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, undefined);
  const [busId, setBusId] = useState(defaultValues?.busId ?? "");
  const [stopId, setStopId] = useState(defaultValues?.stopId ?? "");

  const bus = buses.find((b) => b.id === busId);
  const stops = bus?.stops ?? [];

  return (
    <form action={formAction} className="space-y-4">
      {defaultValues?.id ? <input type="hidden" name="id" value={defaultValues.id} /> : null}

      {state?.message ? (
        <p className="alert-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="studentId">
            Student<span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            id="studentId"
            name="studentId"
            defaultValue={defaultValues?.studentId ?? ""}
            className="field"
          >
            <option value="">Select a student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id} disabled={s.disabled}>
                {s.label}
                {s.disabled ? " (deactivated)" : ""}
              </option>
            ))}
          </select>
          {state?.errors?.studentId ? (
            <p className="mt-1 text-xs font-medium text-red-600">{state.errors.studentId}</p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="busId">
            Bus<span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            id="busId"
            name="busId"
            value={busId}
            onChange={(e) => {
              setBusId(e.target.value);
              // The previously chosen stop belongs to the old route, so clear it
              // rather than silently submitting a mismatched pair.
              setStopId("");
            }}
            className="field"
          >
            <option value="">Select a bus</option>
            {buses.map((b) => (
              <option key={b.id} value={b.id} disabled={!b.hasRoute}>
                {b.label}
                {!b.hasRoute ? " (no route — cannot enrol)" : ""}
              </option>
            ))}
          </select>
          {state?.errors?.busId ? (
            <p className="mt-1 text-xs font-medium text-red-600">{state.errors.busId}</p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="stopId">
            Pickup stop<span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            id="stopId"
            name="stopId"
            value={stopId}
            onChange={(e) => setStopId(e.target.value)}
            disabled={!busId}
            className="field"
          >
            <option value="">
              {busId ? "Select a stop" : "Choose a bus first"}
            </option>
            {stops.map((s) => (
              <option key={s.id} value={s.id} disabled={s.disabled}>
                {s.label}
                {s.disabled ? " (inactive)" : ""}
              </option>
            ))}
          </select>
          {state?.errors?.stopId ? (
            <p className="mt-1 text-xs font-medium text-red-600">{state.errors.stopId}</p>
          ) : null}
          {busId && stops.length === 0 ? (
            <p className="mt-1 text-xs text-amber-600">
              This bus has no stops on its route. Add stops to the route first.
            </p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="direction">
            Direction
          </label>
          <select
            id="direction"
            name="direction"
            defaultValue={defaultValues?.direction ?? "PICKUP"}
            className="field"
          >
            {directionOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Most students need both: one assignment each way.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="academicYear">
            Academic year<span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            id="academicYear"
            name="academicYear"
            defaultValue={defaultValues?.academicYear ?? academicYears[0]}
            className="field"
          >
            {academicYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {state?.errors?.academicYear ? (
            <p className="mt-1 text-xs font-medium text-red-600">
              {state.errors.academicYear}
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <Submit />
      </div>
    </form>
  );
}
