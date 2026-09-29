"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { login, type AuthState } from "@/app/actions/auth";

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
      {state?.message ? (
        <p className="alert-error">{state.message}</p>
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
        />
        {state?.errors?.email?.[0] ? (
          <p className="mt-1 text-xs text-red-600">{state.errors.email[0]}</p>
        ) : null}
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
        />
        {state?.errors?.password?.[0] ? (
          <p className="mt-1 text-xs text-red-600">{state.errors.password[0]}</p>
        ) : null}
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
