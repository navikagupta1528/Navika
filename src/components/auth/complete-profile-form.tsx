"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { completeProfile, type AuthState } from "@/app/actions/auth";
import { Spinner } from "@/components/ui/primitives";
import { Eye, EyeOff } from "lucide-react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? (
        <>
          <Spinner />
          Saving…
        </>
      ) : (
        "Save & Continue"
      )}
    </button>
  );
}

export function CompleteProfileForm({ role }: { role: string }) {
  const [state, setState] = useState<AuthState>(undefined);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function onSubmit(formData: FormData) {
    setState(undefined);
    const res = await completeProfile(undefined, formData);
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
        <label className="label" htmlFor="name">Full Name</label>
        <input id="name" name="name" type="text" required className="field" placeholder="Enter your full name" />
      </div>

      <div>
        <label className="label" htmlFor="phone">Phone Number</label>
        <input id="phone" name="phone" type="tel" required className="field" placeholder="10-digit mobile number" />
      </div>

      {role === "DRIVER" && (
        <>
          <div>
            <label className="label" htmlFor="licenseNo">License Number</label>
            <input id="licenseNo" name="licenseNo" type="text" required className="field" placeholder="DL number" />
          </div>
          <div>
            <label className="label" htmlFor="licenseExpiry">License Expiry</label>
            <input id="licenseExpiry" name="licenseExpiry" type="date" className="field" />
          </div>
          <div>
            <label className="label" htmlFor="experienceYr">Experience (years)</label>
            <input id="experienceYr" name="experienceYr" type="number" min="0" className="field" placeholder="e.g. 5" />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor="newPassword">New Password</label>
        <div className="relative">
          <input id="newPassword" name="newPassword" type={showPassword ? "text" : "password"} required minLength={6} className="field pr-10" />
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">Confirm Password</label>
        <div className="relative">
          <input id="confirmPassword" name="confirmPassword" type={showConfirm ? "text" : "password"} required minLength={6} className="field pr-10" />
          <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700" aria-label={showConfirm ? "Hide password" : "Show password"}>
            {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
