import Link from "next/link";

import { LoginForm, type LoginRole } from "./login-form";

/**
 * The body shared by the four sign-in pages.
 *
 * The pages are separate routes on purpose. A single form that accepts any role
 * has to guess what "25cse01" means and what to do with an account that turns out
 * to be a parent; separate routes make the expected credential explicit before
 * anything is typed, and the Server Action enforces it afterwards.
 *
 * Admin is deliberately not in the tab strip. It is linked from the site footer
 * instead, so the transport office has its own door and the three everyday
 * audiences do not have to read past it.
 */
const PUBLIC_ROLES: { role: LoginRole; href: string; label: string }[] = [
  { role: "STUDENT", href: "/login", label: "Student" },
  { role: "PARENT", href: "/login/parent", label: "Parent" },
  { role: "DRIVER", href: "/login/driver", label: "Driver" },
];

const HEADINGS: Record<
  LoginRole,
  { title: string; description: string }
> = {
  STUDENT: {
    title: "Student sign in",
    description:
      "Use your college roll number. Upper or lower case is fine — 25CSE01 and 25cse01 are the same account.",
  },
  PARENT: {
    title: "Parent sign in",
    description:
      "Use the username your college gave you, or the email address on your account.",
  },
  DRIVER: {
    title: "Driver sign in",
    description:
      "Use the driver username from your transport office, or your email address.",
  },
  ADMIN: {
    title: "Administrator sign in",
    description:
      "For the transport office only. This page is not linked from the student, parent or driver sign-in screens.",
  },
};

export function RoleLogin({ role }: { role: LoginRole }) {
  const heading = HEADINGS[role];

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {heading.title}
      </h1>
      <p className="mt-1 mb-5 text-sm text-slate-500">{heading.description}</p>

      {role === "ADMIN" ? (
        <p className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Looking for the student, parent or driver sign-in?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Go to the main sign-in page
          </Link>
        </p>
      ) : (
        <nav aria-label="Sign-in type" className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {PUBLIC_ROLES.map((item) => {
            const active = item.role === role;
            return (
              <Link
                key={item.role}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-lg bg-white px-2 py-1.5 text-center text-sm font-semibold text-slate-900 shadow-sm"
                    : "rounded-lg px-2 py-1.5 text-center text-sm font-medium text-slate-600 hover:text-slate-900"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}

      <LoginForm role={role} />
    </div>
  );
}
