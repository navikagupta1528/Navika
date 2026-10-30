"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { changePassword, type AuthState } from "@/app/actions/auth";
import { Spinner } from "@/components/ui/primitives";
import { Eye, EyeOff } from "lucide-react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? (
        <>
          <Spinner />
          Updating…
        </>
      ) : (
        "Set password"
      )}
    </button>
  );
}

export function ChangePasswordForm() {
  const [state, setState] = useState<AuthState>(undefined);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function onSubmit(formData: FormData) {
    setState(undefined);
    const res = await changePassword(undefined, formData);
    setState(res);
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {state?.message ? (
        <p role="alert" className="alert-error">
          {state.message}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="newPassword">
          New password
        </label>
        <div className="relative">
          <input
            id="newPassword"
            name="newPassword"
            type={showPassword ? "text" : "password"}
            required
            minLength={6}
            className="field pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          Confirm password
        </label>
        <div className="relative">
          <input
            id="confirmPassword"
            name="confirmPassword"
            type={showConfirm ? "text" : "password"}
            required
            minLength={6}
            className="field pr-10"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700"
            aria-label={showConfirm ? "Hide password" : "Show password"}
          >
            {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
