"use server";

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/session";
import { markAllRead } from "@/lib/notifications";
import { removeSubscriptions, saveSubscription } from "@/lib/push";

/**
 * Notification actions.
 *
 * `markAllRead` is a separate action rather than a prop on the list because the
 * list is a Client Component that already has the items in hand; sending the
 * whole list back to the server to mark it read would be trusting the client
 * with which rows it owns. The server re-reads the session and updates exactly
 * the caller's own unread rows.
 */
export async function markAllReadAction(): Promise<{ ok: boolean }> {
  const session = await readSession();
  if (!session) return { ok: false };

  await markAllRead(session.userId);
  revalidatePath("/notifications");
  return { ok: true };
}

/**
 * Register a browser for push.
 *
 * The subscription payload arrives from the browser, so the endpoint is treated
 * as untrusted input and length-checked before it is stored: an unbounded string
 * written to a `@unique` column is a cheap way to fill the table from a public
 * endpoint.
 */
export async function subscribePush(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ ok: boolean; error?: string }> {
  const session = await readSession();
  if (!session) return { ok: false, error: "Please sign in again." };

  const endpoint = input?.endpoint?.trim();
  const p256dh = input?.keys?.p256dh?.trim();
  const auth = input?.keys?.auth?.trim();

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, error: "That subscription was incomplete." };
  }
  // Real push endpoints are a few hundred characters. The cap is well above
  // that and well below anything that would matter as a denial-of-service.
  if (endpoint.length > 1000 || p256dh.length > 200 || auth.length > 100) {
    return { ok: false, error: "That subscription was not a valid push endpoint." };
  }

  await saveSubscription(session.userId, {
    endpoint,
    p256dh,
    auth,
    userAgent: null,
  });
  return { ok: true };
}

export async function unsubscribePush(): Promise<{ ok: boolean }> {
  const session = await readSession();
  if (!session) return { ok: false };

  await removeSubscriptions(session.userId);
  return { ok: true };
}
