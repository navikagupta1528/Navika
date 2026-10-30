"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { Avatar, IconBadge, staggerIndex } from "@/components/ui/primitives";
import { BrandMark } from "@/components/ui/brand-mark";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  /**
   * A name from the icon registry, not a component.
   *
   * Navigation is assembled in the Server Component layouts and rendered here,
   * on the client, so whatever crosses that boundary has to be serialisable - a
   * component is not. `IconName` is a union, so a typo is a type error rather
   * than a nav item that silently loses its glyph.
   */
  icon: IconName;
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
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark size={32} />
          <span className="font-semibold tracking-tight text-slate-900">
            BusGuard
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost px-3 py-1.5 text-xs"
          aria-expanded={open}
          aria-controls="portal-nav"
        >
          <Icon name={open ? "close" : "menu"} className="h-4 w-4" />
          {open ? "Close" : "Menu"}
        </button>
      </header>

      {/* Sidebar */}
      <aside
        id="portal-nav"
        className={cn(
          "shrink-0 border-slate-200 bg-white lg:flex lg:w-64 lg:flex-col lg:border-r",
          open ? "busguard-slide-down block border-b" : "hidden",
        )}
      >
        <div className="hidden items-center gap-3 border-b border-slate-200 px-5 py-4 lg:flex">
          <BrandMark size={36} />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-slate-900">
              BusGuard
            </p>
            <p className="truncate text-[11px] text-slate-500">{roleLabel}</p>
          </div>
        </div>

        {/*
          `relative` on the nav is what positions `.busguard-rail`, which is a
          ::before on the active link. The rail is decorative - the background
          tint and `aria-current` carry the state - so it stays out of the
          accessibility tree.
        */}
        <nav className="relative flex-1 space-y-1 p-3">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Menu
          </p>
          {nav.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // `busguard-navlink` carries the hover slide and background.
                  // `transition-colors` is deliberately NOT used on its own any
                  // more: the class transitions background-color and transform
                  // together, and a second `transition` here would override the
                  // shorthand's property list and drop the movement.
                  "busguard-navlink group relative flex items-center gap-3 rounded-xl py-2 pl-4 pr-3 text-sm font-medium",
                  active
                    ? "busguard-rail bg-brand-50 text-brand-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-linear-to-br from-brand-500 to-brand-700 text-white shadow-sm"
                      : "bg-slate-100 text-slate-500 group-hover:bg-white",
                  )}
                >
                  <Icon name={item.icon} className="h-4 w-4" />
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          {gpsState ? <div className="mb-3">{gpsState}</div> : null}
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50 p-2">
            <Avatar name={userName} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {userName}
              </p>
              <p className="truncate text-[11px] text-slate-500">{roleLabel}</p>
            </div>
          </div>
          <form action={logout}>
            <button type="submit" className="btn-secondary w-full text-xs">
              <Icon name="logout" className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="busguard-stagger mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** A small kicker above the title, e.g. the section name. */
  eyebrow?: string;
  /** A decorative glyph beside the title. */
  icon?: IconName;
}) {
  return (
    <div
      className="mb-6 flex flex-wrap items-start justify-between gap-4"
      // No `busguard-rise` here: this div is a direct child of the shell's
      // `.busguard-stagger`, so it is already animated. Adding the class again
      // would be a second `animation` shorthand fighting the first. The index
      // is -1 so the header lands ahead of the content below it.
      style={staggerIndex(-1)}
    >
      <div className="flex items-start gap-3">
        {icon ? <IconBadge name={icon} tone="brand" size="lg" /> : null}
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}
