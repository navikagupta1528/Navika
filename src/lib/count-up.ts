/**
 * The easing for a stat that changes while you are watching it.
 *
 * Pure, and pure for a reason that has nothing to do with taste: this file is
 * imported by a Client Component that renders on the server too, and anything
 * reading a clock at module scope would make the server's value and the client's
 * value differ. The unit tests here run with no DOM, no database and no clock,
 * which is only true because every input is passed in.
 */

/** How long a change takes to settle. Long enough to read, short enough to ignore. */
export const COUNT_UP_MS = 520;

/**
 * Progress through the animation at `elapsed` milliseconds.
 *
 * Returns 0 at the start, 1 at and after the end, and never leaves [0, 1] - a
 * value outside that range would render a number the dashboard never had.
 */
export function countUpProgress(elapsed: number, duration = COUNT_UP_MS): number {
  /*
   * `NaN` first, and separately from the other guards, because it is the one
   * input that is not "less than" or "greater than" anything. `elapsed <= 0` is
   * false for NaN and `elapsed >= duration` is also false for NaN, so an earlier
   * version of this that tested only those two fell through to the arithmetic
   * and returned NaN - which then rendered as the text "NaN" in a stat tile.
   * Infinity is handled here too rather than by the comparison below, so that a
   * runaway clock reads as finished instead of dividing Infinity by a number.
   */
  if (Number.isNaN(elapsed)) return 0;
  if (elapsed <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  if (!Number.isFinite(elapsed) || elapsed >= duration) return 1;
  const t = elapsed / duration;
  /*
   * Cubic ease-out. The value covers most of its distance in the first third of
   * the time and then settles, which is what makes the change legible: a linear
   * ramp spends most of its duration creeping through the last few units, where
   * a reader has stopped looking.
   *
   * This is the same curve as the `cubic-bezier(0.16, 1, 0.3, 1)` used in CSS,
   * approximated by `1 - (1 - t)^3`. It has to be arithmetic rather than a call
   * into a timing function, because there is no Animation Timing API for plain
   * numbers - `Element.animate` cannot tween an arbitrary value in a text node.
   */
  return 1 - Math.pow(1 - t, 3);
}

/**
 * The number to show partway through.
 *
 * `from` and `to` are rounded before interpolation rather than after, so the
 * displayed value is always an integer. A stat tile that briefly reads "41.7
 * students" is worse than one that does not move at all.
 */
export function countUpValue(from: number, to: number, elapsed: number): number {
  return Math.round(from + (to - from) * countUpProgress(elapsed));
}

/**
 * Should this change be animated at all?
 *
 * Some changes should not be, and the reasons are about trust rather than taste:
 *
 *  - A value that did not change must not animate. Re-running the entrance on
 *    every render would make a dashboard flicker on each poll, which trains
 *    people to stop watching it.
 *  - Non-integers are not this feature's subject. Formatting a percentage or a
 *    currency amount through an integer interpolation would round away the part
 *    the reader came for.
 *  - A very large jump is a data correction, not an event. Animating 0 to 4,000
 *    spends the whole duration looking like a spinner.
 */
export function shouldAnimateChange(from: number, to: number): boolean {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (from === to) return false;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  return Math.abs(to - from) < 1000;
}