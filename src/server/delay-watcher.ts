/**
 * The delay watcher: "your bus is running late."
 *
 * The geofence watcher tells a family the bus is *here*; this one tells them it
 * should have been here twenty minutes ago. Both run off the same arrival event,
 * but they answer different questions and go out at different thresholds, so
 * they are separate.
 *
 * WHAT MAKES A DELAY WORTH SENDING
 *
 * Not every late bus. A parent who is told "2 min late" at 7:41am learns to
 * ignore the alert, and an alert that is ignored when it matters is worse than
 * no alert at all. So the threshold is five minutes, and the message is only
 * sent when the delay clears it.
 *
 * WHY DEDUPED PER STOP, LIKE EVERY OTHER ALERT
 *
 * A family boards at one stop. The delay that matters to them is measured
 * against *their* stop's schedule, and they are told once, when the bus reaches
 * it. Claiming a "DELAY" ring in the same table gives the same durable,
 * once-per-run, survives-a-restart guarantee the arrival rings have.
 *
 * NEVER THROWS
 *
 * Same contract as the geofence and boarding watchers. A delay alert is a
 * courtesy layered on a tracking system that is still working.
 */

import { prisma } from "@/lib/db";
import { NotificationType } from "@/generated/prisma/enums";
import { notifyMany } from "@/lib/notifications";
import {
  delayMinutesFromSchedule,
  formatDelayPhrase,
  isSignificantDelay,
} from "@/lib/delay";
import { geofenceDateKey } from "@/lib/geofence";
import { isUniqueViolation, type GeofenceDirection } from "./geofence-watcher";

export type DelayInput = {
  busId: string;
  stopId: string;
  stopName: string;
  direction: GeofenceDirection;
  tripId: string;
  /** The stop's scheduled time, "HH:MM" local. Null when the route has none. */
  scheduledHHMM: string | null;
  /** The moment the bus was reported at the stop. */
  arrivedAt: Date;
  busLabel: string | null;
};

export async function evaluateDelay(input: DelayInput): Promise<void> {
  try {
    if (!input.scheduledHHMM) return;

    const minutes = delayMinutesFromSchedule(input.scheduledHHMM, input.arrivedAt);
    if (!isSignificantDelay(minutes)) return;

    const date = geofenceDateKey(input.arrivedAt);
    const claimed = await claimDelayRing(input, date);
    if (!claimed) return;

    await fanOutDelay(input, minutes);
  } catch (error) {
    console.error("[delay] evaluation failed:", error);
  }
}

/**
 * Write the DELAY ring. Returns false when another tick already reported it.
 *
 * Same argument as every other claim in this family: taken before the
 * notification, so a crash between the two costs one missed alert rather than a
 * duplicate a parent cannot explain.
 */
async function claimDelayRing(input: DelayInput, date: string): Promise<boolean> {
  try {
    await prisma.stopApproach.create({
      data: {
        busId: input.busId,
        stopId: input.stopId,
        tripId: input.tripId,
        direction: input.direction,
        ring: "DELAY",
        radiusMeters: 0,
        notifiedAt: input.arrivedAt,
        date: new Date(`${date}T00:00:00`),
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Tell the families waiting at this stop that the bus is late.
 *
 * Resolved through `Enrollment`, exactly like the arrival alert: the guardians
 * of the students who actually board here, plus the students themselves.
 */
async function fanOutDelay(input: DelayInput, minutes: number): Promise<void> {
  const enrollments = await prisma.enrollment.findMany({
    where: { busId: input.busId, stopId: input.stopId, direction: input.direction, isActive: true },
    select: {
      student: {
        select: {
          user: { select: { id: true, name: true } },
          guardians: { select: { parent: { select: { userId: true } } } },
        },
      },
    },
  });

  if (enrollments.length === 0) return;

  const busLabel = input.busLabel ?? "Your bus";
  const phrase = formatDelayPhrase(minutes);
  const title = `${busLabel} is running late`;
  const body = `${busLabel} reached ${input.stopName} about ${phrase}. It may still be a little while before it reaches your stop.`;

  const inputs = enrollments.flatMap((enrollment) => [
    ...enrollment.student.guardians.map((guardian) => ({
      userId: guardian.parent.userId,
      type: NotificationType.DELAY,
      title,
      body,
      href: `/track/${input.busId}`,
    })),
    {
      userId: enrollment.student.user.id,
      type: NotificationType.DELAY,
      title,
      body,
      href: `/track/${input.busId}`,
    },
  ]);

  await notifyMany(inputs);
}
