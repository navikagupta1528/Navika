"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { login, type AuthState } from "@/app/actions/auth";
import { FieldError, describedBy } from "./field-error";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(login, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {/*
        role="alert" so a screen reader announces the refusal instead of the page
        silently doing nothing. This is the single most important announcement in
        the app: a wrong password and a throttle both arrive *only* after the user
        acts, so there is no visual change for a screen reader to notice on its
        own. See `field-error.tsx` for the wider fix.
      */}
      {state?.message ? (
        <p role="alert" className="alert-error">
          {state.message}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@college.edu"
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
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
          aria-invalid={state?.errors?.password?.[0] ? true : undefined}
          aria-describedby={describedBy(
            state?.errors?.password?.[0] ? "password-error" : undefined,
          )}
        />
        <FieldError id="password-error" message={state?.errors?.password?.[0]} />
      </div>

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
