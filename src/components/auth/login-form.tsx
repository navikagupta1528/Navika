"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { login, type AuthState } from "@/app/actions/auth";
import { FieldError, describedBy } from "./field-error";
import { Spinner } from "@/components/ui/primitives";
import { Eye, EyeOff } from "lucide-react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? (
        <>
          <Spinner />
          Signing in…
        </>
      ) : (
        "Sign in"
      )}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(login, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      {state?.message ? (
        <p role="alert" className="alert-error">
          {state.message}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="identifier">
          Username / Roll No.
        </label>
        <input
          id="identifier"
          name="email"
          type="text"
          autoComplete="username"
          required
          placeholder="25cse01 or driver01"
          className="field"
          aria-invalid={state?.errors?.email?.[0] ? true : undefined}
          aria-describedby={describedBy(
            state?.errors?.email?.[0] ? "email-error" : undefined,
          )}
        />
        <FieldError id="email-error" message={state?.errors?.email?.[0]} />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="field pr-10"
            aria-invalid={state?.errors?.password?.[0] ? true : undefined}
            aria-describedby={describedBy(
              state?.errors?.password?.[0] ? "password-error" : undefined,
            )}
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
        <FieldError id="password-error" message={state?.errors?.password?.[0]} />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" name="rememberMe" value="1" className="rounded border-slate-300" />
        Remember me
      </label>

      <SubmitButton />

      <p className="text-center text-sm text-slate-600">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          Register as student or parent
        </Link>
      </p>
    </form>
  );
}
