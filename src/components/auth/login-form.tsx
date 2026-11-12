"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { login, type AuthState } from "@/app/actions/auth";
import { FieldError, describedBy } from "./field-error";
import { Spinner } from "@/components/ui/primitives";
import { Eye, EyeOff } from "lucide-react";

/**
 * Each sign-in page is a separate route and posts its own role.
 *
 * The action refuses a password that belongs to another role, so the split is
 * enforced rather than cosmetic - see `login` in `src/app/actions/auth.ts`.
 */
export type LoginRole = "STUDENT" | "PARENT" | "DRIVER" | "ADMIN";

const COPY: Record<
  LoginRole,
  { label: string; placeholder: string; hint: string }
> = {
  STUDENT: {
    label: "Roll number",
    placeholder: "25cse01",
    hint: "Your roll number, e.g. 25cse01. Upper or lower case both work.",
  },
  PARENT: {
    label: "Username or email",
    placeholder: "parent1",
    hint: "The username your college gave you (parent1 … parent8), or your email address.",
  },
  DRIVER: {
    label: "Username or email",
    placeholder: "driver1",
    hint: "The driver username your transport office gave you, or your email address.",
  },
  ADMIN: {
    label: "Username or email",
    placeholder: "admin",
    hint: "Transport office staff only.",
  },
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? (
        <>
          <Spinner />
          Signing in…
        </>
      ) : (
        label
      )}
    </button>
  );
}

export function LoginForm({ role = "STUDENT" }: { role?: LoginRole }) {
  const [state, formAction] = useActionState<AuthState, FormData>(login, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const copy = COPY[role];

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="role" value={role} />

      {state?.message ? (
        <p role="alert" className="alert-error">
          {state.message}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="identifier">
          {copy.label}
        </label>
        <input
          id="identifier"
          name="email"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder={copy.placeholder}
          className="field"
          aria-invalid={state?.errors?.email?.[0] ? true : undefined}
          aria-describedby={describedBy(
            "identifier-hint",
            state?.errors?.email?.[0] ? "email-error" : undefined,
          )}
        />
        <p id="identifier-hint" className="mt-1 text-xs text-slate-500">
          {copy.hint}
        </p>
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

      <SubmitButton label={role === "ADMIN" ? "Sign in to admin" : "Sign in"} />

      {role === "STUDENT" ? (
        <p className="text-center text-sm text-slate-600">
          No account yet?{" "}
          <Link href="/register" className="font-medium text-brand-700 hover:underline">
            Register as student or parent
          </Link>
        </p>
      ) : null}
    </form>
  );
}
