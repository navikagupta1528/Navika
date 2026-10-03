"use client";

/**
 * A stat that visibly moves when its number changes.
 *
 * The reason this is its own component rather than a line inside `StatTile` is
 * hydration. `StatTile` is a server component and renders on every dashboard, so
 * anything it does has to be safe to serialise. This one is deliberately the
 * client, and deliberately renders the *final* value on the server:
 *
 *   server render:            41
 *   first client render:      41   <- identical, or React discards the page
 *   after mount, on a change: 41 -> 44 over roughly half a second
 *
 * The rule that makes it work is that the first render is a function of props
 * alone. The tween lives in state that starts at the prop, so the two renders
 * agree by construction rather than by luck. This is the same lesson as
 * PushToggle from the other direction: there the unknown was the browser, here it
 * is elapsed time.
 *
 * `performance.now()` is read only inside an effect, never during render, for the
 * project-wide reason: a clock in render makes the server's HTML and the client's
 * first render disagree.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { COUNT_UP_MS, countUpValue, shouldAnimateChange } from "@/lib/count-up";
import { cn } from "@/lib/utils";

const REDUCE_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Re-run `getSnapshot` when the OS setting changes, not just on render.
 *
 * Written to survive both the modern and the deprecated listener APIs. Safari
 * below 14 has only `addListener`, and calling a method that does not exist
 * throws *inside a subscription*, which React treats as a crash rather than as a
 * feature it can do without.
 */
function subscribeToMotionPreference(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(REDUCE_MOTION);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  if (typeof query.addListener === "function") {
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }
  return () => {};
}

/**
 * The current preference, after mount.
 *
 * Returns `true` on the server. `useSyncExternalStore` calls this for the server
 * render *and* for the client's hydration pass, so claiming "reduced" on both
 * sides is what makes the two renders identical - and reduced is the safe claim,
 * because it is the one that guarantees no motion.
 */
function readMotionPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(REDUCE_MOTION).matches;
}

export function CountUp({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  /*
   * `shown` starts at `value`, so the server render and the first client render
   * are both the destination. A stat that counts up from zero on load would be
   * describing numbers the dashboard does not have yet.
   */
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  /*
   * "Is a tween in flight?" derived rather than stored.
   *
   * This was a second piece of state, set from the effect body, and that is
   * exactly what `set-state-in-effect` exists to catch: the effect was writing a
   * value it could already compute. `shown !== value` *is* that condition - a
   * tween only ever displays something between its endpoints - so the flag falls
   * out of the render for free, and it cannot get out of step with the tween the
   * way a stored boolean can.
   *
   * It also removes the stale-flag failure entirely: there is no flag to leave
   * stuck on when a tween is cancelled midway.
   */
  const moving = shown !== value;

  /*
   * Why `useSyncExternalStore` and not `useEffect` + `setState`.
   *
   * This started as the obvious thing - an effect that tweens via
   * `requestAnimationFrame` - and eslint's `set-state-in-effect` rule was right to
   * reject it. Two of the branches in that effect wanted to call `setState`
   * synchronously with a value the component already had, and each of those is a
   * wasted render: React commits the effect's output as a second pass, so "the
   * number is 44" would be rendered twice on every change.
   *
   * Reading the OS preference through a store removes the problem rather than
   * suppressing it. The preference is genuinely external state - it belongs to the
   * OS, it can change while the page is open, and it does not exist on the server
   * at all, which is exactly why it cannot be read during the first render:
   *
   *   first render (server and client)  ->  the destination, no tween
   *   after hydration                   ->  store reports the real preference
   *
   * The tween then owns the only remaining state transition, and that one is
   * genuinely asynchronous, so a `setState` per frame is the honest expression of
   * it rather than a redundant render.
   */
  const reduced = useSyncExternalStore(subscribeToMotionPreference, readMotionPreference, () => true);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;

    /*
     * Declined: unchanged, not a number, or a jump too large to be an event.
     * `shown` already holds `value` on every one of these paths - state was
     * initialised from it and the previous tween landed exactly on it - so there
     * is deliberately no `setState` here.
     */
    if (!shouldAnimateChange(from, value)) return;

    /*
     * Ask the DOM again rather than trusting `reduced` alone. The store re-renders
     * when the setting changes, but within a single tween the two can disagree for
     * a frame if someone flips the switch mid-animation, and honouring it at once
     * is the entire point of checking.
     */
    if (reduced || readMotionPreference()) return;

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= COUNT_UP_MS) {
        /*
         * Land on the exact destination rather than the last rounded frame, so the
         * final DOM text is the true value and not an off-by-one from rounding.
         * This is also what clears `moving`, since it is derived from
         * `shown !== value`.
         */
        setShown(value);
        return;
      }
      setShown(countUpValue(from, value, elapsed));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    /*
     * Cancel the frame, not merely stop updating.
     *
     * Without this, a dashboard that navigates away mid-tween leaves a
     * `requestAnimationFrame` loop running against an unmounted component, which
     * React warns about and which keeps the main thread busy for the remainder of
     * the animation. The last rendered digit stays on screen rather than jumping
     * to the final value, which is the same thing a paused animation does.
     */
    return () => cancelAnimationFrame(frame);
    // `reduced` is in the list deliberately: turning the setting on mid-tween has
    // to stop that tween, not merely affect the next one.
  }, [value, reduced]);

  return (
    <span
      className={cn("navika-count-up tabular-nums", className)}
      data-changed={moving ? "true" : undefined}
    >
      {shown}
    </span>
  );
}