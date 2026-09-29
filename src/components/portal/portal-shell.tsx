"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
};

export type PortalShellProps = {
  userName: string;
  roleLabel: string;
  nav: NavItem[];
  /** Shown on the driver view: whether the phone is sharing location. */
  gpsState?: ReactNode;
  children: ReactNode;
};

export function PortalShell({
  userName,
  roleLabel,
  nav,
  gpsState,
  children,
}: PortalShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 lg:flex-row">
      {/* Top bar (mobile) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            N
          </span>
          <span className="font-semibold text-slate-900">Navika</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost px-3 py-1.5 text-xs"
          aria-expanded={open}
          aria-controls="portal-nav"
        >
          {open ? "Close" : "Menu"}
        </button>
      </header>

      {/* Sidebar */}
      <aside
        id="portal-nav"
        className={cn(
          "shrink-0 border-slate-200 bg-white lg:flex lg:w-64 lg:flex-col lg:border-r",
          open ? "block border-b" : "hidden",
        )}
      >
        <div className="hidden items-center gap-2 border-b border-slate-200 px-5 py-4 lg:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            N
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-900">
              Navika
            </p>
            <p className="text-[11px] text-slate-500">{roleLabel}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                isActive(item)
                  ? "bg-brand-50 text-brand-800"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <span aria-hidden className="w-4 text-center">
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          {gpsState ? <div className="mb-3">{gpsState}</div> : null}
          <div className="mb-2 px-1">
            <p className="truncate text-sm font-medium text-slate-800">{userName}</p>
          </div>
          <form action={logout}>
            <button type="submit" className="btn-secondary w-full text-xs">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
