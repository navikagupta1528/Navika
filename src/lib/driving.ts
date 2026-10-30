/**
 * Driver safety scoring, as arithmetic.
 *
 * Pure: no database, no clock of its own. Given two consecutive GPS fixes for a
 * bus, it says whether the driver braked too hard, accelerated too hard, or was
 * speeding — and given a run of such events, it says how safe that driver was.
 *
 * WHY TWO FIXES AND NOT ONE
 *
 * A single speed reading cannot distinguish a driver who is speeding from one
 * who is going downhill, and cannot see braking at all. The signal is in the
 * *change* between fixes, which is why the watcher keeps the previous fix per
 * bus and hands both to this module.
 *
 * WHY A RATE, NOT JUST A SPEED
 *
 * Dropping 20 km/h over ten seconds is an emergency stop; dropping it over two
 * minutes is a normal approach to a light. Judging the change by the time it
 * took is what separates the two, so the thresholds are only applied inside a
 * short interval and a longer gap is ignored entirely — a phone that was off
 * for five minutes must not be read as a five-minute brake.
 *
 * WHY A SCORE AND NOT JUST A LIST
 *
 * A fleet manager does not want a thousand events; they want to know which
 * driver to talk to this week. The score collapses a week of events into one
 * number that can be ranked, and the counts behind it say what to talk about.
 */

export type DrivingEventType = "HARSH_BRAKING" | "HARD_ACCELERATION" | "OVERSPEED";

/** A bus's state at one moment, as the GPS stream reports it. */
export type DrivingFix = {
  lat: number;
  lng: number;
  speedKph: number;
  /** Epoch milliseconds, so the interval between two fixes is a subtraction. */
  at: number;
};

export type DrivingEvent = {
  type: DrivingEventType;
  /** The speed change that triggered it, or the speed itself for overspeed. */
  magnitudeKph: number;
  at: number;
};

/** A speed loss of this much, inside the interval window, is harsh braking. */
export const HARSH_BRAKING_KPH = 15;
/** A speed gain of this much, inside the interval window, is hard acceleration. */
export const HARD_ACCELERATION_KPH = 12;
/** Sustained speed above this is overspeed, whatever the road. */
export const OVERSPEED_KPH = 60;
/**
 * The longest interval over which a speed change is judged.
 *
 * Beyond this the two fixes are not really consecutive — the phone was off, the
 * bus was parked, the signal was lost — and the change between them says nothing
 * about how the driver was driving.
 */
export const MAX_JUDGED_INTERVAL_S = 30;

/** Points off the score for each event. Overspeed costs the most. */
export const SCORE_PENALTIES: Record<DrivingEventType, number> = {
  HARSH_BRAKING: 3,
  HARD_ACCELERATION: 2,
  OVERSPEED: 5,
};

/**
 * Classify the driving between two fixes.
 *
 * Returns zero, one, or two events: a hard brake and an overspeed can both be
 * true of the same interval (a driver who brakes hard is often also fast), and
 * reporting only the first would hide the second.
 */
export function classifyFix(prev: DrivingFix, next: DrivingFix): DrivingEvent[] {
  const events: DrivingEvent[] = [];
  const intervalS = (next.at - prev.at) / 1000;

  // A gap, or a clock that went backwards, is not a driving decision.
  if (intervalS <= 0 || intervalS > MAX_JUDGED_INTERVAL_S) return events;

  const delta = next.speedKph - prev.speedKph;

  if (delta <= -HARSH_BRAKING_KPH) {
    events.push({ type: "HARSH_BRAKING", magnitudeKph: Math.abs(delta), at: next.at });
  } else if (delta >= HARD_ACCELERATION_KPH) {
    events.push({ type: "HARD_ACCELERATION", magnitudeKph: delta, at: next.at });
  }

  // Overspeed is judged on the speed itself, not the change, so it is checked
  // outside the braking/acceleration branch and can accompany either.
  if (next.speedKph > OVERSPEED_KPH) {
    events.push({ type: "OVERSPEED", magnitudeKph: next.speedKph, at: next.at });
  }

  return events;
}

export type DrivingScore = {
  /** 0–100. 100 is a clean week. */
  score: number;
  counts: Record<DrivingEventType, number>;
  total: number;
};

/**
 * Collapse a run of events into one rankable number.
 *
 * A simple subtraction, clamped at zero, rather than a weighted formula: a
 * manager who asks "why is this driver at 74?" can be told "four harsh brakes,
 * two hard accelerations, and two overspeeds", and the arithmetic checks out.
 * A weighted formula would be a number nobody can reconstruct.
 */
export function scoreFromEvents(events: readonly DrivingEvent[]): DrivingScore {
  const counts: Record<DrivingEventType, number> = {
    HARSH_BRAKING: 0,
    HARD_ACCELERATION: 0,
    OVERSPEED: 0,
  };

  let penalty = 0;
  for (const event of events) {
    counts[event.type] += 1;
    penalty += SCORE_PENALTIES[event.type];
  }

  return {
    score: Math.max(0, 100 - penalty),
    counts,
    total: events.length,
  };
}

/** "82 — good" / "45 — needs coaching" — the label a manager scans a list for. */
export function scoreTone(score: number): { label: string; tone: "good" | "fair" | "poor" } {
  if (score >= 80) return { label: "good", tone: "good" };
  if (score >= 60) return { label: "fair", tone: "fair" };
  return { label: "needs coaching", tone: "poor" };
}
