/**
 * Who is calling the hardware ingestion endpoint.
 *
 * A fitted tracker has no session, no cookie and no browser, so it proves who it
 * is with a bearer token. This module turns that header into a bus.
 *
 * Plain Node - no `server-only` marker - because the smoke script imports the
 * same lookup to plant a device against the live cluster, exactly as the other
 * `src/server` modules are used from `scripts/`.
 */
import { prisma } from "@/lib/db";
import { bearerToken, hashDeviceToken, looksLikeDeviceToken } from "@/lib/device-token";

export type DeviceIdentity = {
  deviceId: string;
  busId: string;
  label: string;
};

/**
 * Resolve an `Authorization` header to a device, or null.
 *
 * The token is hashed and looked up by the unique index, so the comparison is a
 * text equality on a hash rather than a scan. The shape check before it avoids a
 * query for a header that is obviously not one of our tokens at all.
 */
export async function authenticateDevice(
  authorization: string | null | undefined,
): Promise<DeviceIdentity | null> {
  const token = bearerToken(authorization);
  if (!token || !looksLikeDeviceToken(token)) return null;

  const device = await prisma.busDevice.findUnique({
    where: { tokenHash: hashDeviceToken(token) },
    select: { id: true, busId: true, label: true, revokedAt: true },
  });

  if (!device || device.revokedAt) return null;

  return { deviceId: device.id, busId: device.busId, label: device.label };
}

/**
 * Note that a device was heard from.
 *
 * Best-effort on purpose: this is bookkeeping for the admin screen, and a failure
 * to write it must not turn an accepted position into a 500. The position itself
 * is already persisted by the time this runs.
 */
export async function touchDevice(deviceId: string, at = new Date()): Promise<void> {
  try {
    await prisma.busDevice.update({ where: { id: deviceId }, data: { lastSeenAt: at } });
  } catch {
    // Bookkeeping only. A dropped update costs one stale "last seen" timestamp.
  }
}
