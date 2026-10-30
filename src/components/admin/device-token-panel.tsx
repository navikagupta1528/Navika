"use client";

/**
 * Fitted-tracker management for one bus.
 *
 * Two halves that look alike and behave differently, which is why they live in
 * one small client component rather than being spread across the server page:
 *
 *   - Minting has to *show* something. The token is returned once from the
 *     action and never stored, so the form has to hold the returned value in
 *     client state and render it until the admin navigates away. A plain
 *     `ActionForm` (fire-and-forget) could not do that.
 *   - Revoking is fire-and-forget, so it uses the existing `ActionForm`.
 *
 * The token is deliberately not copy-to-clipboard-only: a `readOnly` input is
 * selectable and pasteable on every browser, whereas the Clipboard API needs a
 * secure context and can fail silently on the LAN address this is often opened
 * from. A read-only field is the honest default; the browser's own selection is
 * the fallback that always works.
 */
import { useActionState } from "react";
import { Badge } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { FieldError, describedBy } from "@/components/auth/field-error";
import { createBusDevice, revokeBusDevice } from "@/app/actions/admin/buses";
import { timeAgo } from "@/lib/utils";

export type BusDeviceRow = {
  id: string;
  label: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export function DeviceTokenPanel({
  busId,
  devices,
}: {
  busId: string;
  devices: BusDeviceRow[];
}) {
  const [state, action, pending] = useActionState(createBusDevice, {});
  const labelError = state?.errors?.label;
  const issuedToken = state?.ok && state.message ? state.message : null;

  return (
    <div className="space-y-5">
      {devices.length > 0 ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-slate-900">
                  <span className="truncate">{device.label}</span>
                  {device.revokedAt ? (
                    <Badge tone="slate">revoked</Badge>
                  ) : device.lastSeenAt ? (
                    <Badge tone="emerald">reporting</Badge>
                  ) : (
                    <Badge tone="amber">never seen</Badge>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  added {timeAgo(device.createdAt)} ·{" "}
                  {device.lastSeenAt
                    ? `last position ${timeAgo(device.lastSeenAt)}`
                    : "no position yet"}
                </p>
              </div>
              {device.revokedAt ? null : (
                <ActionForm
                  action={revokeBusDevice}
                  hidden={{ id: device.id, busId }}
                  label="Revoke"
                  className="btn-ghost shrink-0 text-xs text-red-600"
                  confirm={`Revoke the token for "${device.label}"? The tracker will be refused on its next report.`}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">
          No tracker fitted. Generate a token and load it into the device to report this
          bus&apos;s position without anyone&apos;s phone.
        </p>
      )}

      {issuedToken ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">
            Copy this token now — it is shown once and cannot be retrieved.
          </p>
          <input
            readOnly
            value={issuedToken}
            aria-label="New tracker token"
            onFocus={(event) => event.currentTarget.select()}
            className="field mt-2 font-mono text-xs"
          />
          <p className="mt-2 text-xs text-amber-800">
            The tracker sends it as{" "}
            <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> to{" "}
            <code className="font-mono">POST /api/ingest/location</code>.
          </p>
        </div>
      ) : null}

      <form action={action} className="space-y-3 border-t border-slate-200 pt-4">
        <input type="hidden" name="busId" value={busId} />
        <div>
          <label className="label" htmlFor="device-label">
            Tracker label
          </label>
          <input
            id="device-label"
            name="label"
            className="field"
            placeholder="Tracker in the glovebox"
            maxLength={60}
            aria-invalid={labelError ? true : undefined}
            aria-describedby={describedBy(labelError ? "device-label-error" : undefined)}
          />
          <FieldError id="device-label-error" message={labelError} />
        </div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Generating…" : "Generate token"}
        </button>
      </form>
    </div>
  );
}
