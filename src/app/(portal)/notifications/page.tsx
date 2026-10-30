import type { Metadata } from "next";
import { requireRole } from "@/lib/dal";
import { homeForRole } from "@/lib/dal";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader, type NavItem } from "@/components/portal/portal-shell";
import { NotificationList } from "@/components/notifications/notification-list";
import { listNotifications, markAllRead, unreadNotificationCount } from "@/lib/notifications";
import { getPublicVapidKey, isPushConfigured } from "@/lib/push";
import { PushToggle } from "@/components/notifications/push-toggle";

export const metadata: Metadata = { title: "Notifications" };

/**
 * The notification inbox.
 *
 * Reachable by every role, including drivers — a driver who is told to report a
 * bus that went quiet should be able to see it in the same place as everyone
 * else rather than only on the admin dashboard.
 */
export default async function NotificationsPage() {
  const session = await requireRole(
    Role.STUDENT,
    Role.PARENT,
    Role.DRIVER,
    Role.ADMIN,
  );

  const [items, unread] = await Promise.all([
    listNotifications(session.userId, 50),
    unreadNotificationCount(session.userId),
  ]);

  // Opening the inbox is what marks it read. Doing it here rather than in a
  // client effect means the write lands in the same request as the read that
  // justified it: no intermediate render where the rows are unread, and no
  // second round trip to fix the count. `unread` is captured first so the page
  // can still report how many were new.
  if (unread > 0) await markAllRead(session.userId);

  const nav: NavItem[] = [
    { href: homeForRole(session.role), label: "Dashboard", icon: "overview" },
    { href: "/notifications", label: "Notifications", icon: "bell" },
  ];

  return (
    <PortalShell userName={session.role} roleLabel={session.role} nav={nav}>
      <PageHeader
        title="Notifications"
        icon="bell"
        description={
          unread > 0
            ? `${unread} new ${unread === 1 ? "message" : "messages"} since you last looked.`
            : "Everything you have been told."
        }
        action={<PushToggle vapidPublicKey={getPublicVapidKey()} supported={isPushConfigured()} />}
      />

      <NotificationList items={items} newCount={unread} />
    </PortalShell>
  );
}
