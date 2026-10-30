/*
 * NOTE: no `import "server-only"` here, for the same reason `db.ts` has none.
 * The geofence watcher delivers its alerts through `notifyMany`, and it runs on
 * the plain-Node custom server (`tsx server.ts`), outside React's `react-server`
 * condition where the marker package throws. See `src/lib/push.ts` for the full
 * note; every consumer of this file is a Server Component, a Server Action or
 * Node, so nothing here can leak into the browser bundle.
 */

/**
 * Who gets told what, and when.
 *
 * Two rules shape everything here:
 *
 *  1. A notification is written to the database even when nobody is listening.
 *     Push delivery is best-effort and the phone may be off; the inbox is the
 *     durable record, and it is the same row either way. Anything that reaches
 *     a phone first has to exist in the inbox regardless, otherwise the app
 *     shows a badge for a message that vanishes when you open it.
 *
 *  2. Notifications go to *people*, not to roles. "Tell the parents" means the
 *     guardians of a specific student on a specific trip, resolved through
 *     `ParentChild`. Notifying by role would blast every parent in the college
 *     with someone else's child arriving.
 */

import { prisma } from "@/lib/db";
import { NotificationType, Role } from "@/generated/prisma/enums";
import { pushToUser } from "@/server/realtime-emit";
import { sendPushToUser } from "@/lib/push";
import { formatTime } from "@/lib/utils";

export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** A link the notification deep-links into, e.g. `/track/<busId>`. */
  href?: string | null;
};

/**
 * Write one notification and try to deliver it.
 *
 * Never throws. A failure to notify is not a failure of the operation that
 * caused it — a parent whose push failed still has a correct attendance record
 * — so delivery problems are logged and swallowed here rather than unwinding
 * the caller's transaction.
 */
export async function notify(input: NotificationInput): Promise<void> {
  try {
    const created = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.href ? { href: input.href } : undefined,
      },
      select: { id: true, createdAt: true },
    });

    // The open socket gets it instantly; a phone with the app closed gets it
    // from web push. Neither is allowed to fail the write above.
    pushToUser(input.userId, "notification:new", {
      id: created.id,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      createdAt: created.createdAt.toISOString(),
    });

    await sendPushToUser(input.userId, {
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      tag: input.type,
    });
  } catch (error) {
    console.error("[notify] delivery failed:", error);
  }
}

/** Fan one notification out to many users without awaiting each in sequence. */
export async function notifyMany(inputs: NotificationInput[]): Promise<void> {
  await Promise.all(inputs.map((input) => notify(input)));
}

/**
 * Everyone entitled to know that a specific student was picked up: their
 * guardians, plus the student themselves.
 *
 * Guardians come from `ParentChild`, so a student with two parents gets two
 * notifications and a student with none gets none — which is exactly right,
 * and impossible to get from a role query.
 */
export async function notifyGuardiansOfPickup(
  studentId: string,
  tripId: string,
  at: Date,
): Promise<void> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      busId: true,
      direction: true,
      bus: { select: { busNumber: true } },
      pickupRecords: {
        where: { studentId, status: "PICKED" },
        take: 1,
        select: { stop: { select: { name: true } } },
      },
    },
  });
  if (!trip) return;

  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: {
      user: { select: { id: true, name: true } },
      guardians: { select: { parent: { select: { userId: true } } } },
    },
  });
  if (!student) return;

  const first = student.user.name.split(" ")[0];
  const stopName = trip.pickupRecords[0]?.stop.name ?? "their stop";
  const verb = trip.direction === "PICKUP" ? "picked up" : "dropped off";

  // The clock time is the part a parent actually looks for — "7:40 am" answers
  // "are they on the bus yet" far better than a push that just appeared. It goes
  // through `formatTime` rather than a local `toLocaleTimeString`, so the time
  // in this notification is rendered by the same rule as every other time in the
  // product. A second copy of the formatting would drift from the first the
  // moment either one changed.
  const body = `${first} was ${verb} at ${stopName} at ${formatTime(at)}, by ${trip.bus.busNumber}.`;
  const title = verb === "picked up" ? "Picked up" : "Dropped off";
  const href = `/track/${trip.busId}`;

  await notifyMany([
    ...student.guardians.map((g) => ({
      userId: g.parent.userId,
      type: NotificationType.PICKED_UP,
      title,
      body,
      href,
    })),
    { userId: student.user.id, type: NotificationType.PICKED_UP, title, body, href },
  ]);
}

/**
 * Tell every admin that something needs a human. Used for emergency alerts and
 * for a bus that has gone quiet mid-run, which is the failure mode nobody
 * notices until a parent phones the college.
 */
export async function notifyAdmins(
  type: NotificationType,
  title: string,
  body: string,
  href?: string | null,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });
  await notifyMany(admins.map((a) => ({ userId: a.id, type, title, body, href })));
}

/** A driver's phone that stopped reporting during an ongoing trip. */
export async function notifyAdminsOfSilentBus(busId: string, minutes: number): Promise<void> {
  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: { busNumber: true, registrationNo: true },
  });
  if (!bus) return;

  await notifyAdmins(
    NotificationType.INFO,
    `${bus.busNumber} has gone quiet`,
    `No position from ${bus.registrationNo} for ${minutes} minutes during a trip that is still running.`,
    `/admin/buses/${busId}`,
  );
}

// ---------------------------------------------------------------------------
// Reading the inbox
// ---------------------------------------------------------------------------

export async function listNotifications(userId: string, take = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
  });
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/**
 * Mark everything read.
 *
 * One call, no per-row loop: the inbox has no paging, and a family with a
 * hundred unread messages should not need a hundred round trips.
 */
export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
