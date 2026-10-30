/**
 * The rules behind every attendance write, with no request in scope.
 *
 * Why this file exists
 * --------------------
 * These operations used to live inside `"use server"` actions, which read the
 * session cookie and call `revalidatePath`. That made them impossible to
 * exercise without a browser: a Server Action invoked from client code has no
 * `$ACTION_*` hidden input on the page to replay, and `Next-Action` ids are a
 * build artifact. So the write paths — the ones holding the actual
 * authorization rule, "is this person on this trip" — had no test at all.
 *
 * That gap was not theoretical. `student: { parentProfile: { userId } }` is a
 * filter that reads correctly and compiles cleanly in some positions, and it
 * names a relation `StudentProfile` does not have. Prisma throws on it at
 * runtime, on the code path that decides whether a parent may see their child.
 * Nothing in the HTTP suite reached it, because nothing in the HTTP suite
 * reached *any* of these writes.
 *
 * So each operation is split in two: a plain function here that takes an
 * explicit `Actor` and returns a result, and a thin action that resolves the
 * cookie and revalidates. The rule is now callable from a script, so it is
 * asserted in `scripts/smoke-tracking.ts`.
 *
 * Two constraints held on purpose:
 *
 *  - No `next/headers`, no `next/cache`. Nothing here may read the request.
 *  - Socket pushes stay. They are a no-op when no server is attached to this
 *    process, so calling them from a script is safe and keeps the fan-out in
 *    exactly one place.
 */

import "server-only";
import { prisma } from "@/lib/db";
import { Role, PickupStatus, AlertType, NotificationType } from "@/generated/prisma/enums";
import { studentScopeFor, busScopeFor } from "@/lib/student-scope";
import { pushPickupUpdate, pushAlert } from "@/server/realtime-emit";
import { notifyAdmins, notifyGuardiansOfPickup, notifyMany } from "@/lib/notifications";

/** Who is acting. Resolved from the cookie by the action; explicit everywhere else. */
export type Actor = { userId: string; role: Role };

/**
 * The shape every operation here answers with.
 *
 * `ok: false` carries a message meant to be shown to a person standing on a
 * pavement, not a stack trace. A 500 tells a driver nothing about what to do
 * next, and these fire from phones.
 */
export type OpResult =
  | { ok: true; message?: string; revalidate: string[] }
  | { ok: false; error: string };

const VALID_STATUSES = Object.values(PickupStatus) as string[];

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Which trip, if any, is this person driving today?
 *
 * Returns an empty `userId` for a refusal rather than null, because the call
 * sites all want a truthiness check and none of them can act on the bus id
 * without the driver check having passed.
 */
export async function assertTripDriver(
  actor: Actor,
  tripId: string,
): Promise<{ userId: string; busId: string }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, driverId: true, busId: true },
  });
  if (!trip) return { userId: "", busId: "" };

  // Admins pass, because an admin correcting attendance mid-route is ordinary
  // operations. Students and parents never do: attendance is the driver's claim
  // to make, and letting a family mark its own would make the report fiction.
  const allowed = trip.driverId === actor.userId || actor.role === Role.ADMIN;
  if (!allowed) return { userId: "", busId: "" };

  return { userId: actor.userId, busId: trip.busId };
}

/**
 * The caller's own `PickupRecord` on a trip.
 *
 * Three roles mean three different things by "my record": a student looks
 * themselves up by user, a parent looks up any child whose guardian they are,
 * and a driver has no record here at all. Shared by `markWaiting` and by the
 * student/parent read paths, so the two cannot disagree about who a child is.
 */
export async function locatePickupRecord(
  actor: Actor,
  tripId: string,
): Promise<{
  id: string;
  tripId: string;
  studentId: string;
  stopId: string;
  busId: string | null;
  status: PickupStatus;
} | null> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, busId: true },
  });
  if (!trip) return null;

  const record = await prisma.pickupRecord.findFirst({
    where: { tripId, student: studentScopeFor(actor.userId, actor.role) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      tripId: true,
      studentId: true,
      stopId: true,
      status: true,
    },
  });

  if (!record) return null;
  return { ...record, busId: trip.busId };
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/**
 * Record a student's status on a trip.
 *
 * One function behind three buttons in the driver UI — picked, missed, and undo
 * — so the status arrives as a value rather than as three near-identical
 * actions that could drift apart in their guards.
 */
export async function setPickupStatus(
  actor: Actor,
  input: { recordId: string; tripId: string; status: string },
): Promise<OpResult> {
  const { recordId, tripId, status: raw } = input;

  if (!recordId || !tripId) {
    return { ok: false, error: "Missing record or trip." };
  }
  if (!VALID_STATUSES.includes(raw)) {
    return { ok: false, error: "That is not a valid status." };
  }
  const status = raw as PickupStatus;

  const { userId, busId } = await assertTripDriver(actor, tripId);
  if (!userId) return { ok: false, error: "You are not the driver for this trip." };

  // The record must belong to the trip named in the form. Without this a driver
  // could post a valid tripId alongside somebody else's recordId and mark a
  // child who is not on their bus.
  const record = await prisma.pickupRecord.findUnique({
    where: { id: recordId },
    select: { id: true, tripId: true, stopId: true, studentId: true },
  });
  if (!record || record.tripId !== tripId) {
    return { ok: false, error: "That student is not on this trip." };
  }

  const now = new Date();
  const data =
    status === PickupStatus.PICKED
      ? { status, pickedAt: now, cancelledAt: null }
      : status === PickupStatus.MISSED
        ? { status, cancelledAt: now }
        : { status, pickedAt: null, cancelledAt: null };

  await prisma.pickupRecord.update({ where: { id: recordId }, data });
  await syncOnboardCount(tripId, busId);

  pushPickupUpdate(busId, {
    pickupRecordId: record.id,
    tripId,
    studentId: record.studentId,
    stopId: record.stopId,
    status,
    waitingMarkedAt: null,
    pickedAt: status === PickupStatus.PICKED ? now.toISOString() : null,
  });

  // The single most valuable notification this product sends, fired on the
  // pick-up itself rather than when the trip ends: a parent asking "are they on
  // the bus" gets an answer the moment there is one.
  if (status === PickupStatus.PICKED) {
    await notifyGuardiansOfPickup(record.studentId, tripId, now);
  }

  return {
    ok: true,
    revalidate: [`/driver/checklist`, `/admin/trips/${tripId}`, `/parent`, `/student`],
  };
}

/**
 * Keep `Bus.onboardCount` equal to the number of students actually on board.
 *
 * A recount, not an increment. An increment drifts the moment anyone changes a
 * status twice, and a headcount that is off by one is a number an admin cannot
 * trust while the bus is at the gate deciding who is still inside.
 */
export async function syncOnboardCount(tripId: string, busId: string): Promise<number> {
  const picked = await prisma.pickupRecord.count({
    where: { tripId, status: PickupStatus.PICKED },
  });
  await prisma.bus.update({ where: { id: busId }, data: { onboardCount: picked } });
  return picked;
}

/** Mark everyone still outstanding at a stop as missed, as the bus pulls away. */
export async function closeStop(
  actor: Actor,
  input: { tripId: string; stopId: string },
): Promise<OpResult> {
  const { tripId, stopId } = input;
  if (!tripId || !stopId) return { ok: false, error: "Missing trip or stop." };

  const { userId, busId } = await assertTripDriver(actor, tripId);
  if (!userId) return { ok: false, error: "You are not the driver for this trip." };

  await prisma.pickupRecord.updateMany({
    where: { tripId, stopId, status: { in: [PickupStatus.PENDING, PickupStatus.WAITING] } },
    data: { status: PickupStatus.MISSED },
  });

  await syncOnboardCount(tripId, busId);

  pushPickupUpdate(busId, {
    tripId,
    stopId,
    status: "STOP_CLOSED",
    pickupRecordId: "",
    studentId: "",
    waitingMarkedAt: null,
    pickedAt: null,
  });

  return { ok: true, revalidate: [`/driver/checklist`, `/admin/trips/${tripId}`] };
}

// ---------------------------------------------------------------------------
// Student / parent: "I am at the stop"
// ---------------------------------------------------------------------------

/**
 * A student or guardian marks that they are at the stop.
 *
 * This is what makes the product student-aware rather than a map with a dot: the
 * driver sees "3 waiting" before arriving and slows down instead of blowing past
 * four people who were standing there.
 *
 * Parents may set it on a child's behalf. The school run is usually run by
 * whoever is at home, and making them switch accounts to press one button means
 * the feature goes unused, which costs the students the benefit.
 */
export async function markWaiting(
  actor: Actor,
  input: { tripId: string; waiting: boolean },
): Promise<OpResult> {
  const { tripId, waiting } = input;
  if (!tripId) return { ok: false, error: "Missing trip." };

  const record = await locatePickupRecord(actor, tripId);
  if (!record) return { ok: false, error: "You have no stop on this trip." };

  // Once the driver has resolved this student, the student has no further say.
  //
  // Both refusals apply in *either* direction, and that is the whole point. An
  // earlier version gated them on `!waiting`, on the reasoning that only
  // "clearing" could be destructive. It cannot: a student sending `waiting:
  // true` against a record already marked PICKED wrote WAITING straight over the
  // driver's decision — erasing the pick-up, dropping the bus's onboard count,
  // telling the bus room someone is still standing at a stop they have left, and
  // leaving the "your child is on the bus" notification that was already sent
  // quietly untrue. Nothing about the direction of the flag makes the driver's
  // record less authoritative.
  if (record.status === PickupStatus.PICKED) {
    return { ok: false, error: "You have already been picked up." };
  }
  if (record.status === PickupStatus.MISSED) {
    return { ok: false, error: "The bus has already left this stop." };
  }

  const now = new Date();
  const status = waiting ? PickupStatus.WAITING : PickupStatus.PENDING;

  await prisma.pickupRecord.update({
    where: { id: record.id },
    data: { status, waitingMarkedAt: waiting ? now : null },
  });

  // The bus room is what the driver is actually looking at, so it goes there.
  if (record.busId) {
    pushPickupUpdate(record.busId, {
      pickupRecordId: record.id,
      tripId,
      studentId: record.studentId,
      stopId: record.stopId,
      status,
      waitingMarkedAt: waiting ? now.toISOString() : null,
      pickedAt: null,
    });
  }

  return {
    ok: true,
    message: waiting ? "The driver can see you are waiting." : "Cleared.",
    revalidate: ["/student", "/parent", `/driver/checklist`, `/track/${record.busId}`],
  };
}

/**
 * Confirm a child the bus left behind is accounted for.
 *
 * The one-tap button behind the guardian's "the bus left without your child"
 * alert. The record stays MISSED — the bus really did leave without them — so
 * this writes an acknowledgement on top of the fact rather than correcting it,
 * and the reports can still ask "how many were left behind" and, within that,
 * "how many were confirmed safe".
 *
 * Who may press it: a guardian of this child, the child themself, or an admin.
 * The rule is a relationship check, not a role check, for the same reason every
 * other operation here is — a parent confirming somebody else's child is safe
 * would close an incident that is not theirs to close.
 */
export async function confirmPickupSafe(
  actor: Actor,
  input: { recordId: string },
): Promise<OpResult> {
  const { recordId } = input;
  if (!recordId) return { ok: false, error: "Missing record." };

  const record = await prisma.pickupRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      status: true,
      safeMarkedAt: true,
      tripId: true,
      stop: { select: { name: true } },
      student: {
        select: {
          user: { select: { id: true, name: true } },
          guardians: { select: { parent: { select: { userId: true } } } },
        },
      },
    },
  });
  if (!record) return { ok: false, error: "That record no longer exists." };

  const entitled =
    actor.role === Role.ADMIN ||
    record.student.user.id === actor.userId ||
    record.student.guardians.some((g) => g.parent.userId === actor.userId);
  if (!entitled) {
    return { ok: false, error: "That is not your child's record." };
  }

  // Both refusals are idempotent by design: a confirmation is a fact about a
  // child, not a toggle, so pressing it twice must not write twice.
  if (record.status !== PickupStatus.MISSED) {
    return { ok: false, error: "Only a child the bus left behind needs confirming." };
  }
  if (record.safeMarkedAt) {
    return { ok: false, error: "Already confirmed safe." };
  }

  const now = new Date();
  await prisma.pickupRecord.update({
    where: { id: recordId },
    data: { safeMarkedAt: now, safeMarkedById: actor.userId },
  });

  // Tell the people who were told the child was left behind that they are safe.
  // The same audience that got the alarm gets the all-clear, so a family that
  // only reads the inbox still closes the loop.
  const first = record.student.user.name.split(" ")[0];
  const stopName = record.stop.name;
  await notifyMany([
    ...record.student.guardians.map((g) => ({
      userId: g.parent.userId,
      type: NotificationType.INFO,
      title: `${first} is safe`,
      body: `${first} was left at ${stopName} and has been confirmed safe.`,
      href: "/parent",
    })),
    {
      userId: record.student.user.id,
      type: NotificationType.INFO,
      title: "Marked safe",
      body: `Your stop at ${stopName} has been confirmed.`,
      href: "/student",
    },
  ]);

  return { ok: true, revalidate: ["/parent", "/student"] };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

const ALERT_TYPES: AlertType[] = ["EMERGENCY", "BREAKDOWN", "DELAY", "OTHER"];

/**
 * Which trip is this person on right now?
 *
 * Drivers resolve through their own trips for today; students and parents
 * through a child's enrolment. The bus label comes back too, so the notification
 * reads "NW-1: emergency" rather than a cuid.
 */
export async function resolveReporterTrip(
  actor: Actor,
): Promise<{ tripId: string; busId: string; busLabel: string } | null> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const busWhere =
    actor.role === Role.DRIVER
      ? { trips: { some: { driverId: actor.userId, date: { gte: today, lt: tomorrow } } } }
      : busScopeFor(actor.userId, actor.role);

  const bus = await prisma.bus.findFirst({
    where: busWhere,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      busNumber: true,
      trips: {
        where: { date: { gte: today, lt: tomorrow } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  const tripId = bus?.trips[0]?.id;
  if (!bus || !tripId) return null;
  return { tripId, busId: bus.id, busLabel: bus.busNumber };
}

export type RaiseAlertInput = {
  message: string;
  type?: string;
  lat?: string | number;
  lng?: string | number;
};

/**
 * Raise an alert against the caller's own trip.
 *
 * The trip is never taken from the form: it is resolved from the caller's own
 * bus or child, so an alert is always attached to something the reporter was
 * actually on. A crafted `tripId` would otherwise let anyone point the panic
 * button at somebody else's bus, which turns the emergency channel into a spam
 * vector.
 *
 * Coordinates come from the reporter's own browser and are stored unverified.
 * A student's fix from a basement is worth recording with a location, but not
 * worth sending a van to on its own.
 */
export async function raiseAlert(
  actor: Actor,
  input: RaiseAlertInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const message = input.message.trim();
  const rawType = (input.type ?? "").trim().toUpperCase() as AlertType;
  const type = ALERT_TYPES.includes(rawType) ? rawType : AlertType.OTHER;

  if (message.length < 5) {
    return { ok: false, error: "Say what has happened, in a few words." };
  }

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const hasPosition =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const context = await resolveReporterTrip(actor);
  if (!context) {
    return {
      ok: false,
      error:
        "You are not on a trip right now, so there is no bus to report against. Contact the transport office.",
    };
  }

  const alert = await prisma.emergencyAlert.create({
    data: {
      tripId: context.tripId,
      busId: context.busId,
      type,
      message,
      lat: hasPosition ? lat : null,
      lng: hasPosition ? lng : null,
      raisedById: actor.userId,
    },
    select: { id: true },
  });

  // Everyone already watching the bus sees it at once, the driver included.
  pushAlert(context.busId, {
    id: alert.id,
    busId: context.busId,
    type,
    message,
    lat: hasPosition ? lat : null,
    lng: hasPosition ? lng : null,
    status: "OPEN",
    createdAt: new Date().toISOString(),
  });

  // Admins are not necessarily watching that bus, so they are told separately.
  // This is the path that reaches someone with the app closed.
  await notifyAdmins(
    NotificationType.EMERGENCY,
    `${context.busLabel}: ${type.toLowerCase()}`,
    message,
    "/admin/alerts",
  );

  return { ok: true, id: alert.id };
}
