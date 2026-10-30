import { requireRole, getCurrentUser } from "@/lib/dal";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, type NavItem } from "@/components/portal/portal-shell";
import { getAdminAlerts } from "@/lib/queries";

/**
 * One shell for every admin screen.
 *
 * Previously each page built its own nav, which meant adding a section meant
 * editing several files and the sidebar could drift out of sync with the
 * routes that actually existed. Putting it in the layout makes that impossible:
 * a new page under /admin/* gets the sidebar for free.
 */
export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "overview", exact: true },
  { href: "/admin/trips", label: "Trips", icon: "trips" },
  { href: "/admin/students", label: "Students", icon: "students" },
  { href: "/admin/stops", label: "Stops", icon: "stops" },
  { href: "/admin/routes", label: "Routes", icon: "routes" },
  { href: "/admin/buses", label: "Fleet", icon: "fleet" },
  { href: "/admin/drivers", label: "Drivers", icon: "drivers" },
  { href: "/admin/safety", label: "Safety", icon: "shield" },
  { href: "/admin/alerts", label: "Alerts", icon: "alerts" },
  { href: "/admin/reports", label: "Reports", icon: "reports" },
  // Live fleet is shared by every role rather than living under /admin, so it
  // sits outside ADMIN_NAV: this list is the admin-only sidebar and adding it
  // here would 403 a parent who followed the link from their dashboard.
  { href: "/fleet", label: "Live fleet", icon: "radio" },
  { href: "/notifications", label: "Notifications", icon: "bell" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(Role.ADMIN);
  const user = await getCurrentUser();
  const openAlerts = await getAdminAlerts();

  const nav = ADMIN_NAV.map((item) =>
    item.href === "/admin/alerts" && openAlerts > 0
      ? { ...item, label: `Alerts (${openAlerts})` }
      : item,
  );

  return (
    <PortalShell
      userName={user?.name ?? "Admin"}
      roleLabel="Administrator"
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
