import "server-only";

/**
 * Web push delivery.
 *
 * Notifications are already written to the inbox by `lib/notifications.ts`;
 * this is the extra hop that reaches a phone with the app closed. It is
 * best-effort by design — every function here returns quietly rather than
 * throwing, because a failed push must never roll back the attendance record
 * or the trip update that caused it.
 *
 * The VAPID keys are optional. When they are absent, or when the push service
 * is unreachable, `sendPushToUser` becomes a no-op and the product still works
 * completely, minus the lock-screen alerts. That is deliberate: requiring a
 * push service to run a bus tracker would make the core unusable for anyone
 * self-hosting without one.
 */

import webpush from "web-push";
import { prisma } from "@/lib/db";

let configured = false;

function vapidKeys() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:ops@navika.test";

  if (!publicKey || !privateKey) return null;
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return { publicKey };
}

/** Is push wired up at all? Drives whether the UI offers the toggle. */
export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** The public half, which is safe to hand to the browser. */
export function getPublicVapidKey(): string | null {
  return vapidKeys()?.publicKey ?? null;
}

export type PushMessage = {
  title: string;
  body: string;
  href?: string | null;
  /** Groups messages in the OS tray so a burst becomes one notification. */
  tag?: string;
};

/** HTTP statuses that mean "this endpoint is gone, stop trying". */
const GONE = new Set([404, 410]);

/**
 * Send to every browser this user has subscribed, pruning dead endpoints.
 *
 * A push endpoint is not permanent: browsers expire them, users clear site
 * data, and phones get replaced. Without pruning, the table fills with endpoints
 * that reject every send and every notification costs a full round trip per
 * dead row, forever.
 */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
  const keys = vapidKeys();
  if (!keys) return 0;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) return 0;

  const payload = JSON.stringify(message);
  const dead: string[] = [];

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      ),
    ),
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    const status = (result.reason as { statusCode?: number } | null)?.statusCode;
    // 404 and 410 are the endpoint telling us it no longer exists. Anything
    // else — a 500 from the push service, a DNS failure — is a transient
    // problem and the subscription stays, because deleting on a transient
    // error would silently unsubscribe every device during an outage.
    if (status !== undefined && GONE.has(status)) {
      dead.push(subscriptions[index]!.id);
    }
  });

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
  }

  return results.filter((r) => r.status === "fulfilled").length;
}

/** Register a subscription. Re-subscribing the same endpoint is a no-op update. */
export async function saveSubscription(
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null },
): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
    update: { userId, p256dh: input.p256dh, auth: input.auth },
  });
}

/**
 * Unsubscribe.
 *
 * Deletes every endpoint for the user rather than one, because the browser
 * that called this has usually had all of its subscriptions revoked at once,
 * and leaving the others behind would keep getting this user's notifications
 * on a device they explicitly turned off.
 */
export async function removeSubscriptions(userId: string): Promise<number> {
  const { count } = await prisma.pushSubscription.deleteMany({ where: { userId } });
  return count;
}
