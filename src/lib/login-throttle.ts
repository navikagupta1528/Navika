/**
 * Login and registration throttling.
 *
 * Pure in the sense this codebase means it: no database, no network, no DOM, and
 * no ambient clock. Every function that needs to know what time it is takes it as
 * an argument, which is what lets the schedule below be tested in a millisecond
 * instead of by waiting through it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Sign-in had no attempt limit. Password hashes are stored with bcrypt at cost
 * 12, which is deliberately slow - that is what makes an offline guess expensive,
 * and it is also what makes an *online* guess expensive to the defender for free.
 * But "expensive per attempt" is not "bounded in total". An attacker with a
 * script gets one bcrypt comparison per guess and can keep guessing forever,
 * against a system whose entire purpose is reporting where children are.
 *
 * THE CLASSIC TRAP
 * ----------------
 * Throttle on the submitted email and an attacker who does not have a password
 * still needs nothing else: submit wrong passwords for
 * `aarav.sharma0@student.navika.test` a few times, and that student cannot log
 * in again for as long as the lockout lasts. The limiter that exists to stop an
 * attacker is now the thing the attacker uses. No credentials, no access, no
 * trace.
 *
 * Four things prevent it here:
 *
 * 1. The window caps at fifteen minutes, not an hour. Long enough to make
 *    guessing useless, short enough that being targeted is an annoyance rather
 *    than a lost morning. There is no email-based unlock in this app, so a long
 *    window has no recovery path at all - only an admin manually fixing it.
 *
 * 2. A *successful* login clears the counter. The intended user who eventually
 *    types the right password is never left locked out by their own earlier typo.
 *
 * 3. The message is identical whether or not the account exists, and the counter
 *    is keyed on the submitted email *before* the account is looked up. An
 *    attacker cannot tell a real address from a fake one by watching who gets
 *    throttled, which is the only observable difference the lookup would
 *    otherwise create.
 *
 * 4. The schedules are asymmetric, which is the point of the whole file. See
 *    below.
 *
 * WHY THE TWO SCHEDULES DIFFER
 * ----------------------------
 * There are two budgets, and they are deliberately nowhere near each other.
 *
 * **Per email, strict.** Three free attempts, then the escalating table. This is
 * the control that actually stops guessing: it bounds an attacker's total
 * exposure of any one password to three tries plus the wait, no matter how many
 * addresses, machines or hours they spend.
 *
 * **Per IP, lenient.** Twenty-five free attempts before anything happens at all.
 *
 * That number is set by who is behind the address, not by the attacker. A college
 * runs its sign-ins through one NAT address: every student, every teacher, every
 * parent using the campus wifi arrives from the same IP. At two thousand students
 * a fifteen-minute window on a weekday morning will *comfortably* exceed a dozen
 * mistyped passwords across that one address.
 *
 * So a strict per-IP limit does not defend anything - it converts the limiter into
 * the outage. It is the denial-of-service above, aimed at the whole school at
 * 8:40am, and it needs no credentials at all. A single student who types their
 * password wrong three times each morning would be enough to trigger it, and the
 * fix would be as expensive as it is obvious: the office tells everyone to stop
 * mistyping.
 *
 * Twenty-five is above the plausible human floor and still low enough that a
 * script cannot get through a meaningful number of accounts inside one window.
 * And because per-email is strict regardless, the IP budget is not carrying the
 * security load - it only caps *volume*, which is what it is good at. An attacker
 * who raises their own ceiling from three guesses per account to twenty-five per
 * address has not gained a breach; they have gained a spray, and every account
 * they reach is still cut off after three.
 *
 * The test that matters here is the one asserting twenty-five human failures do
 * not lock anybody out. Without it, the next person to tidy these tables would
 * set them equal, because equal looks tidier, and would ship a school-wide
 * lockout with a comment saying it prevented one.
 *
 * STATE
 * -----
 * In memory, in the Node process. That is a deliberate choice for a
 * single-instance deployment: a redeploy clears the counters, which is the
 * behaviour you want - nobody should be locked out because a deploy happened at
 * the wrong minute. The cost is that counters do not survive a restart, so a
 * restart is a brief amnesty. That trade is acceptable here and would not be on a
 * multi-instance deployment, where the same code would need the Redis adapter the
 * rest of the app does not have.
 */

/**
 * Which budget an attempt spends.
 *
 * Sign-in and registration are throttled separately, and the reason is
 * deployment-shaped rather than theoretical. A college office creates accounts
 * all morning from that same shared address. With a shared budget, their sign-ups
 * would lock out every student behind it - the limiter causing the outage it
 * exists to prevent, one flow over. Separate namespaces mean the office can fill
 * one budget without being able to touch the other.
 *
 * It also stops the two flows from interfering at the account level: a user who
 * signs up and then logs in has spent two different budgets, not four failures on
 * one.
 */
export type ThrottlePurpose = "login" | "register";

/** Free attempts per account before `LOCKOUT_SECONDS` starts refusing. */
export const FREE_ATTEMPTS = 3;

/**
 * Lockout after N failures on one account.
 *
 * Indexed by the failure count *including* the one just recorded, so entry `n` is
 * the penalty for the nth failure and not for the (n+1)th. That is off-by-one-able
 * in a way that matters here: shifted by one, the schedule grants two free
 * attempts while this comment claims three, and it looks correct the whole time.
 * The unit test walks the table itself for exactly that reason - it caught this.
 *
 * The first three failures are free: people mistype passwords, and a limiter that
 * punishes the second attempt gets worked around immediately by anyone who
 * notices - and by anyone who does not notice but stops trying. The growth from
 * there is what does the work, because it makes sustained guessing cost the
 * attacker hours rather than seconds, and it costs a legitimate user nothing they
 * cannot simply wait out.
 *
 * Fifteen minutes is the ceiling rather than an hour for the reason in the trap
 * above: this app has no self-service unlock, so the window length *is* the
 * worst case for a user being targeted.
 */
export const LOCKOUT_SECONDS: readonly number[] = [
  0, 0, 0, 0, 30, 60, 120, 300, 600, 900,
];

/**
 * Free attempts per address before `IP_LOCKOUT_SECONDS` starts refusing.
 *
 * Read the "why the two schedules differ" section before changing this number -
 * it is a school-sized constraint, not a guess about attacker behaviour.
 */
export const IP_FREE_ATTEMPTS = 25;

/**
 * Lockout after N failures from one address.
 *
 * The leading run of zeros is `IP_FREE_ATTEMPTS + 1` long, not
 * `IP_FREE_ATTEMPTS`, because of the indexing above. That single extra slot is
 * the whole difference between "25 attempts are free" and "24 are", and it was
 * wrong twice in a row before a test compared the two values against each other
 * instead of leaving anyone to count a table by eye.
 */
export const IP_LOCKOUT_SECONDS: readonly number[] = [
  ...Array<number>(IP_FREE_ATTEMPTS + 1).fill(0),
  30, 60, 120, 300, 600, 900,
];

/** Longest window any single failure count can reach, on either schedule. */
export const MAX_LOCKOUT_SECONDS = 900;

/**
 * How long a counter survives without a new failure.
 *
 * A success clears immediately, so this is about the *other* case: someone who
 * fat-fingers their password twice, walks away from the keyboard for an hour and
 * comes back. Those two failures should not still be waiting when they do.
 */
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Lockout length after a given number of consecutive failures.
 *
 * `NaN` answers 0 - there is no failure count, so there is nothing to penalise -
 * while a positive infinity clamps to the maximum. Splitting those two is the
 * entire subtlety, and getting it wrong is invisible: an earlier version rejected
 * every non-finite input as "not a real number, so be careful", which quietly
 * mapped infinity to *no penalty* and handed over the exact unbounded run this
 * function exists to prevent, while reading as the more defensible of the two.
 */
export function lockoutSecondsAfter(
  failures: number,
  schedule: readonly number[] = LOCKOUT_SECONDS,
): number {
  if (Number.isNaN(failures) || failures <= 0) return 0;
  const index = Math.min(Math.floor(failures), schedule.length - 1);
  return schedule[index];
}

/**
 * The throttle key for an address.
 *
 * Lowercased, because `Aarav@x.com` and `aarav@x.com` are the same account and
 * must not be two separate budgets. Whitespace is trimmed rather than rejected
 * because the form already validates the shape - this only has to agree with
 * however the database will compare the string.
 *
 * Hashed into a digest rather than used directly: these strings end up as Map
 * keys, and an unbounded email field as a key is one more thing to keep in memory
 * under load. The hash is not a security control here - there is nothing secret
 * in an email address - it just gives a bounded, fixed-width key.
 */
export function throttleKey(purpose: ThrottlePurpose, email: string): string {
  return `${purpose}:${digest(email.trim().toLowerCase())}`;
}

/** Key for an address that is already known. */
export function ipKey(purpose: ThrottlePurpose, ip: string): string {
  return `${purpose}-ip:${digest(ip)}`;
}

/**
 * A short, stable, non-reversible digest.
 *
 * Not a security primitive and not pretending to be one - the inputs are email
 * addresses, which are not secrets and are already all over the database. This
 * exists to turn an unbounded user-supplied string into a bounded key. FNV-1a is
 * chosen because it is four lines, which matters for a function this hot that
 * exists to be cheap.
 */
function digest(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The caller's address, or null when it cannot be determined.
 *
 * `x-forwarded-for` is a comma-separated chain, closest client first, so the
 * *first* entry is the client and not the proxy that appended itself. Taking the
 * last entry - which is what a naive parse does - records the load balancer's own
 * address for every request, which files the entire internet into one budget and
 * then locks out everyone the moment any single requester fails.
 *
 * Both headers are attacker-controlled when the app is reachable directly. That
 * is accepted: spoofing gets a *fresh* budget under a new fake address, which is
 * exactly the spray the per-IP ceiling is for, so it is not a way around the limit
 * - only a way to keep spending. The per-email key cannot be spoofed at all, and it
 * is the half that holds when the header cannot be trusted.
 */
export function clientIp(headers: {
  get(name: string): string | null;
}): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || null;
}

/**
 * The two budgets one attempt spends.
 *
 * A pair rather than a flat list, because the two are governed by different
 * schedules and it has to be impossible to record one against the wrong table.
 *
 * `ip` is null when the address could not be determined, and null is *not*
 * recorded. Bucketing every unidentifiable requester together would let one
 * misbehaving client behind an unconfigured proxy lock out an entire school - so
 * when the address is unknown the per-account limit still applies, and the
 * defence degrades to the half that cannot misfire rather than to nothing.
 */
export type Budget = { email: string; ip: string | null };

export function budgetsFor(
  purpose: ThrottlePurpose,
  email: string,
  ip: string | null,
): Budget {
  return { email: throttleKey(purpose, email), ip: ip ? ipKey(purpose, ip) : null };
}

type Entry = {
  /** Consecutive failures, for choosing the window. */
  failures: number;
  /** Absolute time the lockout ends. 0 when not locked. */
  lockedUntil: number;
  /** Absolute time of the most recent failure. */
  lastFailure: number;
};

/**
 * Per-key failure counters.
 *
 * The clock is a parameter rather than `Date.now()` on every call, so the whole
 * schedule is testable without time passing and without a fake timer.
 */
export type ThrottleStore = {
  /** Is this key clear to proceed right now? */
  check(key: string, now: number): boolean;
  /** Seconds until this key clears, or 0. */
  retryAfter(key: string, now: number): number;
  /** Record a failure against the given schedule. */
  fail(key: string, now: number, schedule: readonly number[]): void;
  /** Clear a key. Called on success only. */
  succeed(key: string): void;
  /** Drop keys untouched for longer than `staleAfterMs`. Returns how many went. */
  sweep(now: number, staleAfterMs: number): number;
  size(): number;
};

export function createThrottleStore(): ThrottleStore {
  const entries = new Map<string, Entry>();

  /**
   * The stored entry, expired in place.
   *
   * Expiry happens on read rather than on a background timer because there is no
   * background timer: this runs inside a Server Action on a request. A key whose
   * failures are older than the window is treated as one that has never failed,
   * which is what makes the window work without anything having to notice the
   * passage of fifteen minutes.
   */
  function live(key: string, now: number): Entry | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (now - entry.lastFailure > FAILURE_WINDOW_MS) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    check(key, now) {
      const entry = live(key, now);
      if (!entry) return true;
      return entry.lockedUntil <= now;
    },

    retryAfter(key, now) {
      const entry = live(key, now);
      if (!entry) return 0;
      if (entry.lockedUntil <= now) return 0;
      return Math.ceil((entry.lockedUntil - now) / 1000);
    },

    fail(key, now, schedule) {
      const previous = live(key, now);
      const failures = (previous?.failures ?? 0) + 1;
      const seconds = lockoutSecondsAfter(failures, schedule);
      entries.set(key, {
        failures,
        lockedUntil: seconds === 0 ? 0 : now + seconds * 1000,
        lastFailure: now,
      });
    },

    succeed(key) {
      // A success wipes the budget entirely. Someone who fumbled twice and then
      // got it right has not demonstrated anything an attacker should inherit.
      entries.delete(key);
    },

    sweep(now, staleAfterMs) {
      let dropped = 0;
      for (const [key, entry] of entries) {
        if (now - entry.lastFailure > staleAfterMs) {
          entries.delete(key);
          dropped++;
        }
      }
      return dropped;
    },

    size() {
      return entries.size;
    },
  };
}

/**
 * Charge a failure to both budgets.
 *
 * Both, not just whichever happens to be locked. An attacker alternating two
 * addresses would otherwise keep one of them permanently fresh by only ever
 * failing on the other, and the address actually in use would never accumulate a
 * budget - so spraying across addresses would cost *less* per address than
 * hammering one, which is precisely backwards.
 */
export function chargeFailure(
  store: ThrottleStore,
  budget: Budget,
  now: number,
): void {
  store.fail(budget.email, now, LOCKOUT_SECONDS);
  if (budget.ip) store.fail(budget.ip, now, IP_LOCKOUT_SECONDS);
}

/** The longest wait across both budgets - what the user is actually told. */
export function longestRetryAfter(
  store: ThrottleStore,
  budget: Budget,
  now: number,
): number {
  const email = store.retryAfter(budget.email, now);
  const ip = budget.ip ? store.retryAfter(budget.ip, now) : 0;
  return Math.max(email, ip);
}

/** Whether this attempt may proceed. */
export function isClear(
  store: ThrottleStore,
  budget: Budget,
  now: number,
): boolean {
  return store.check(budget.email, now) && (!budget.ip || store.check(budget.ip, now));
}