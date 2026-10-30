/**
 * "Your bus is running late" — the arithmetic.
 *
 * Pure: no database, no clock of its own. Given the time a stop was scheduled
 * for and the moment the bus actually reached it, it says how late the run is
 * and whether that is worth telling a family about.
 *
 * WHY A THRESHOLD RATHER THAN EVERY MINUTE
 *
 * A parent does not want "2 min late" at 7:41am. They want to know when the
 * delay is big enough to change what they do — keep the child home five more
 * minutes, or send them to the stop now. Below the threshold the number is
 * noise that re-renders and trains them to ignore the alert.
 *
 * WHY SCHEDULED-AND-ACTUAL, NOT ONE STOP'S DELAY
 *
 * The delay that matters to a family is the delay at *their* stop, measured
 * against *its* scheduled time — not the delay at the previous stop, which
 * says nothing about whether the bus will still be late by the time it reaches
 * them. So this is called per stop, with that stop's own schedule.
 */

/** Minutes late before a delay is worth a notification. */
export const DELAY_NOTIFY_THRESHOLD_MINUTES = 5;

/**
 * How many minutes late the bus is at a stop.
 *
 * Negative means early. `scheduledHHMM` is the `RouteStop.scheduledHHMM` the
 * college office entered, "HH:MM" in local time; `at` is the moment the bus
 * was reported at the stop. Both are read on the same calendar day, so a stop
 * scheduled for 07:30 and reached at 07:38 is eight minutes late.
 */
export function delayMinutesFromSchedule(scheduledHHMM: string, at: Date): number {
  const [hours, minutes] = scheduledHHMM.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;

  const scheduled = new Date(at);
  scheduled.setHours(hours, minutes, 0, 0);

  return Math.round((at.getTime() - scheduled.getTime()) / 60_000);
}

/** "8 min late" / "on time" / "3 min early" — the part a family acts on. */
export function formatDelayPhrase(minutes: number): string {
  if (minutes <= -1) return `${Math.abs(minutes)} min early`;
  if (minutes <= 0) return "on time";
  return `${minutes} min late`;
}

/** Whether a delay is significant enough to interrupt a family. */
export function isSignificantDelay(minutes: number): boolean {
  return minutes >= DELAY_NOTIFY_THRESHOLD_MINUTES;
}
