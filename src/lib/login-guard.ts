import "server-only";

/**
 * The process-wide throttle state, and the request wiring around it.
 *
 * `src/lib/login-throttle.ts` holds the schedule and the store and is pure; this
 * file is the only thing that owns a *live* store and the only thing that knows
 * where a request's address comes from. Split that way because the part worth
 * testing has no opinion about Next.js and the part that does is a handful of
 * lines.
 */

import { headers } from "next/headers";

import {
  budgetsFor,
  chargeFailure,
  clientIp,
  createThrottleStore,
  isClear,
  longestRetryAfter,
  type Budget,
  type ThrottlePurpose,
} from "@/lib/login-throttle";

/**
 * One store for the whole process.
 *
 * Module scope rather than per-request, because a per-request store would forget
 * everything between two guesses and throttle nothing at all. It survives for the
 * lifetime of the Node process, which is the same lifetime the deployment has -
 * see the state discussion in `login-throttle.ts` for why that is acceptable and
 * where it would stop being.
 */
const store = createThrottleStore();

/**
 * When to sweep expired keys.
 *
 * Sweeping on every request would put a Map iteration in the path of every
 * sign-in for no benefit, and a timer would keep the process alive on its own.
 * Sweeping only once the map is large turns an unbounded-memory problem into a
 * periodic O(n) pass that almost never runs.
 *
 * The threshold is generous because a Map of small objects is cheap: this is a
 * backstop against a sustained flood of *distinct* addresses, not a memory budget
 * for a normal day, which will hold a few hundred entries at most.
 */
const SWEEP_AT = 5000;

/** How long a key with no recent failure is kept before being dropped. */
const SWEEP_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Drop expired keys if the map has grown enough to be worth walking.
 *
 * Called from the failure path only. A successful attempt clears its own keys, so
 * sweeping there would do nothing, and a request refused before it reached the
 * password check has no new key to grow the map.
 */
function sweepIfCrowded(): void {
  if (store.size() > SWEEP_AT) store.sweep(Date.now(), SWEEP_STALE_MS);
}

async function budgetFor(purpose: ThrottlePurpose, email: string): Promise<Budget> {
  return budgetsFor(purpose, email, clientIp(await headers()));
}

export type ThrottleVerdict =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Is this attempt of this kind allowed to proceed?
 *
 * Called *before* the work happens, which is the whole point: bcrypt at cost 12
 * is the attacker's cost as well as ours, and checking after would mean paying it
 * on every attempt we intend to refuse.
 */
export async function checkThrottle(
  purpose: ThrottlePurpose,
  email: string,
): Promise<ThrottleVerdict> {
  const budget = await budgetFor(purpose, email);
  const now = Date.now();
  if (isClear(store, budget, now)) return { ok: true };
  return { ok: false, retryAfterSeconds: longestRetryAfter(store, budget, now) };
}

/** Record a failed attempt against both budgets. */
export async function recordFailure(
  purpose: ThrottlePurpose,
  email: string,
): Promise<void> {
  chargeFailure(store, await budgetFor(purpose, email), Date.now());
  sweepIfCrowded();
}

/**
 * Clear the budget after a success.
 *
 * Not a nicety: someone who mistyped twice and then got it right has shown
 * nothing an attacker should inherit, and leaving the counter in place is how
 * people end up locked out of their own account by their own typo.
 */
export async function recordSuccess(
  purpose: ThrottlePurpose,
  email: string,
): Promise<void> {
  const budget = await budgetFor(purpose, email);
  store.succeed(budget.email);
  if (budget.ip) store.succeed(budget.ip);
}

/**
 * The message shown while a budget is locked.
 *
 * One string for every locked case and every account state, because the throttle
 * is the one thing on this screen that can be triggered for an address that does
 * not exist. Varying it - "too many attempts" for a real account, "incorrect
 * password" for a fake one - would turn the limiter into an account oracle.
 *
 * Rounded up to minutes on purpose. The exact countdown would tick once per
 * second against a Server Action that has already returned, so there would be
 * nothing to tick it and the number would go stale on screen - worse than a
 * coarser honest figure.
 */
export function lockedOutMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1
    ? "Too many failed attempts. Try again in a minute."
    : `Too many failed attempts. Try again in ${minutes} minutes.`;
}