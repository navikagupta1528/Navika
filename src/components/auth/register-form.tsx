"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { register, type AuthState } from "@/app/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    register,
    undefined,
  );
  const [role, setRole] = useState<"STUDENT" | "PARENT">("STUDENT");

  const err = (key: string) => state?.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-4">
      {state?.message ? (
        <p className="alert-error">{state.message}</p>
      ) : null}

      <fieldset>
        <legend className="label">I am a</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "STUDENT", label: "Student" },
              { value: "PARENT", label: "Parent / Guardian" },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition ${
                role === option.value
                  ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Driver and admin accounts are created by your college office, not
          through public sign-up.
        </p>
      </fieldset>

      <div>
        <label className="label" htmlFor="name">
          Full name
        </label>
        <input id="name" name="name" required className="field" autoComplete="name" />
        {err("name") ? (
          <p className="mt-1 text-xs text-red-600">{err("name")}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="field"
          autoComplete="email"
        />
        {err("email") ? (
          <p className="mt-1 text-xs text-red-600">{err("email")}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="phone">
          Phone (optional)
        </label>
        <input
          id="phone"
          name="phone"
          className="field"
          placeholder="+91 98765 43210"
          autoComplete="tel"
        />
        {err("phone") ? <p className="mt-1 text-xs text-red-600">{err("phone")}</p> : null}
      </div>

      {role === "STUDENT" ? (
        <div className="grid gap-4 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <div>
            <label className="label" htmlFor="enrollmentNo">
              Enrollment number
            </label>
            <input
              id="enrollmentNo"
              name="enrollmentNo"
              required
              className="field"
              placeholder="CSE2026-0142"
            />
            {err("enrollmentNo") ? (
              <p className="mt-1 text-xs text-red-600">{err("enrollmentNo")}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="department">
                Department
              </label>
              <input
                id="department"
                name="department"
                className="field"
                placeholder="Computer Science"
              />
            </div>
            <div>
              <label className="label" htmlFor="yearOfStudy">
                Year
              </label>
              <select id="yearOfStudy" name="yearOfStudy" className="field" defaultValue="">
                <option value="">Select</option>
                {[1, 2, 3, 4, 5].map((y) => (
                  <option key={y} value={y}>
                    Year {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <div>
            <label className="label" htmlFor="childEnrollmentNo">
              Your child&apos;s enrollment number
            </label>
            <input
              id="childEnrollmentNo"
              name="childEnrollmentNo"
              required
              className="field"
              placeholder="CSE2026-0142"
            />
            <p className="mt-1 text-xs text-slate-500">
              The student must already be registered. Contact the college
              office if this fails.
            </p>
            {err("childEnrollmentNo") ? (
              <p className="mt-1 text-xs text-red-600">{err("childEnrollmentNo")}</p>
            ) : null}
          </div>
          <div>
            <label className="label" htmlFor="relation">
              Relationship
            </label>
            <select id="relation" name="relation" className="field" defaultValue="MOTHER">
              <option value="MOTHER">Mother</option>
              <option value="FATHER">Father</option>
              <option value="GUARDIAN">Guardian</option>
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="field"
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-slate-500">
          At least 8 characters, with a letter and a number.
        </p>
        {err("password") ? (
          <p className="mt-1 text-xs text-red-600">{err("password")}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          className="field"
          autoComplete="new-password"
        />
        {err("confirmPassword") ? (
          <p className="mt-1 text-xs text-red-600">{err("confirmPassword")}</p>
        ) : null}
      </div>

      <SubmitButton />

      <p className="text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
