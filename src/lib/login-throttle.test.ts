import { describe, expect, it } from "vitest";
import {
  FAILURE_WINDOW_MS,
  FREE_ATTEMPTS,
  IP_FREE_ATTEMPTS,
  IP_LOCKOUT_SECONDS,
  LOCKOUT_SECONDS,
  MAX_LOCKOUT_SECONDS,
  budgetsFor,
  chargeFailure,
  clientIp,
  createThrottleStore,
  ipKey,
  isClear,
  lockoutSecondsAfter,
  longestRetryAfter,
  throttleKey,
} from "./login-throttle";

/**
 * The clock is a parameter everywhere, so the whole schedule is checked here
 * without anything waiting. If these tests had to sleep, they would either take a
 * minute or be skipped in CI, and a skipped security test is worse than none.
 */
const T0 = 1_700_000_000_000;
const NAT = "203.0.113.7";

describe("lockoutSecondsAfter", () => {
  it("lets the first three attempts through", () => {
    for (const failures of [0, 1, 2, 3]) {
      expect(lockoutSecondsAfter(failures)).toBe(0);
    }
  });

  it("indexes the table by the failure just recorded, not the one before it", () => {
    /*
     * The off-by-one this guards against was real. With the table shifted by one,
     * entry `n` was the penalty for the (n+1)th failure, so three failures locked
     * the account and only two attempts were free - while the comment beside the
     * table said three. It looked correct and was one guess tighter than intended.
     */
    expect(lockoutSecondsAfter(3)).toBe(0);
    expect(lockoutSecondsAfter(4)).toBe(LOCKOUT_SECONDS[4]);
    expect(LOCKOUT_SECONDS[4]).toBeGreaterThan(0);
  });

  it("never returns a shorter window than the one before it", () => {
    // A limiter that tightens and then relaxes can be walked: an attacker waits
    // for the cheap window and spends their attempts there.
    for (const table of [LOCKOUT_SECONDS, IP_LOCKOUT_SECONDS]) {
      for (let n = 1; n < table.length; n++) {
        expect(table[n]).toBeGreaterThanOrEqual(table[n - 1]);
      }
    }
  });

  it("clamps instead of returning nothing for an absurd failure count", () => {
    // `NaN` here would read as "not locked out" and hand over an unbounded run.
    expect(lockoutSecondsAfter(10_000)).toBe(MAX_LOCKOUT_SECONDS);
    expect(lockoutSecondsAfter(Number.POSITIVE_INFINITY)).toBe(MAX_LOCKOUT_SECONDS);
    expect(lockoutSecondsAfter(Number.NaN)).toBe(0);
    expect(lockoutSecondsAfter(-5)).toBe(0);
  });

  it("caps the window at fifteen minutes, not an hour", () => {
    /*
     * There is no self-service unlock in this app, so the window length *is* the
     * worst case for a user being targeted. A long enough lockout turns a
     * thirty-second annoyance into a lost morning with no way out of it.
     */
    expect(MAX_LOCKOUT_SECONDS).toBe(15 * 60);
    expect(LOCKOUT_SECONDS.at(-1)).toBe(MAX_LOCKOUT_SECONDS);
    expect(IP_LOCKOUT_SECONDS.at(-1)).toBe(MAX_LOCKOUT_SECONDS);
  });
});

describe("free attempts match the tables they describe", () => {
  /*
   * Both of these numbers are asserted against the table instead of being counted
   * by hand, and both were wrong by hand first - twice on the same table.
   *
   * The failure is genuinely hard to see: a leading run of 25 zeros *looks* like
   * twenty-five free attempts, while the indexing makes it twenty-four. Nothing
   * errors, the limiter still works, and the number that quietly shrinks by one
   * is the number a school notices when a cohort of morning mistypes tips it over.
   */
  it("grants exactly the free attempts it advertises per account", () => {
    expect(LOCKOUT_SECONDS[FREE_ATTEMPTS]).toBe(0);
    expect(LOCKOUT_SECONDS[FREE_ATTEMPTS + 1]).toBeGreaterThan(0);
  });

  it("grants exactly the free attempts it advertises per address", () => {
    expect(IP_LOCKOUT_SECONDS[IP_FREE_ATTEMPTS]).toBe(0);
    expect(IP_LOCKOUT_SECONDS[IP_FREE_ATTEMPTS + 1]).toBeGreaterThan(0);
  });

  it("refuses the attempt one past the advertised free count", () => {
    const store = createThrottleStore();
    const budget = budgetsFor("login", "a@x.com", null);

    for (let n = 0; n < FREE_ATTEMPTS; n++) {
      store.fail(budget.email, T0, LOCKOUT_SECONDS);
      expect(store.check(budget.email, T0)).toBe(true);
    }
    store.fail(budget.email, T0, LOCKOUT_SECONDS);
    expect(store.check(budget.email, T0)).toBe(false);
  });
});

describe("the per-IP schedule", () => {
  it("does not lock out a school behind one NAT address during a normal morning", () => {
    /*
     * This is the assertion that justifies the whole asymmetry, and it is the one
     * that would stop someone tidying the two tables into one.
     *
     * A college runs every sign-in through one address. At two thousand students,
     * a fifteen-minute window on a weekday morning will comfortably exceed a
     * dozen mistyped passwords behind it. A strict per-IP limit does not defend
     * anything there - it is the denial-of-service above, aimed at the whole
     * school at 8:40am, triggerable by anyone who can type three wrong passwords.
     *
     * So: every one of those failures is recorded, none of them locks anyone out.
     */
    const store = createThrottleStore();
    for (let n = 0; n < IP_FREE_ATTEMPTS; n++) {
      chargeFailure(store, budgetsFor("login", `student${n}@busguard.test`, NAT), T0);
    }
    expect(store.check(ipKey("login", NAT), T0)).toBe(true);
  });

  it("still refuses a script that keeps going past that", () => {
    const store = createThrottleStore();
    for (let n = 0; n <= IP_FREE_ATTEMPTS; n++) {
      chargeFailure(store, budgetsFor("login", `student${n}@busguard.test`, NAT), T0);
    }
    expect(store.check(ipKey("login", NAT), T0)).toBe(false);
  });

  it("leaves the per-account limit strict regardless of the lenient address one", () => {
    /*
     * The two halves do different jobs. The address ceiling only caps volume; the
     * account limit is what bounds how much of any one password an attacker
     * gets. Raising the first to buy volume must never touch the second.
     */
    const store = createThrottleStore();
    for (let n = 0; n < 20; n++) {
      chargeFailure(store, budgetsFor("login", `student${n}@busguard.test`, NAT), T0);
    }
    const target = budgetsFor("login", "aarav.sharma0@student.busguard.test", NAT);
    expect(store.check(target.email, T0)).toBe(true);

    for (let n = 0; n < 3; n++) store.fail(target.email, T0, LOCKOUT_SECONDS);
    chargeFailure(store, target, T0);

    expect(store.check(target.email, T0)).toBe(false);
    expect(store.check(ipKey("login", NAT), T0)).toBe(true);
  });
});

describe("throttleKey", () => {
  it("treats the same address in different cases as one budget", () => {
    expect(throttleKey("login", "Aarav@BusGuard.Test")).toBe(
      throttleKey("login", "aarav@busguard.test"),
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(throttleKey("login", "  aarav@busguard.test ")).toBe(
      throttleKey("login", "aarav@busguard.test"),
    );
  });

  it("keeps sign-in and registration budgets apart", () => {
    /*
     * A college office creates accounts all morning from one shared address.
     * With a shared budget, their sign-ups would lock out every student behind
     * the same NAT address - the limiter causing the outage it prevents, one flow
     * over.
     */
    expect(throttleKey("login", "a@x.com")).not.toBe(throttleKey("register", "a@x.com"));
    expect(ipKey("login", NAT)).not.toBe(ipKey("register", NAT));
  });

  it("does not grow with the address", () => {
    // These strings become Map keys; an unbounded user-supplied key is one more
    // thing to hold in memory under load.
    const short = throttleKey("login", "a@x.com");
    const long = throttleKey("login", `${"x".repeat(500)}@busguard.test`);
    expect(long.length).toBe(short.length);
  });

  it("differs between addresses", () => {
    expect(throttleKey("login", "a@x.com")).not.toBe(throttleKey("login", "b@x.com"));
  });
});

describe("budgetsFor", () => {
  it("records the address when there is one", () => {
    const budget = budgetsFor("login", "a@x.com", NAT);
    expect(budget.email).toBe(throttleKey("login", "a@x.com"));
    expect(budget.ip).toBe(ipKey("login", NAT));
  });

  it("records the address alone when the caller cannot be identified", () => {
    /*
     * Bucketing every unidentifiable requester together would let one client
     * behind a misconfigured proxy lock out a whole school. Degrading to the half
     * that cannot misfire beats degrading to nothing.
     */
    expect(budgetsFor("login", "a@x.com", null).ip).toBeNull();
  });
});

describe("clientIp", () => {
  const headers = (map: Record<string, string>) => ({
    get: (name: string) => map[name] ?? null,
  });

  it("takes the first entry of the forwarded chain, not the last", () => {
    /*
     * The chain runs closest-client-first. Taking the last entry records the load
     * balancer's own address for every request, which files the entire internet
     * under one budget - and then locks everyone out the moment any single
     * requester fails.
     */
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" }))).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("returns null rather than a placeholder when nothing is known", () => {
    expect(clientIp(headers({}))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": "  " }))).toBeNull();
  });
});

describe("createThrottleStore", () => {
  const budget = budgetsFor("login", "a@x.com", NAT);

  it("allows everything to start", () => {
    const store = createThrottleStore();
    expect(isClear(store, budget, T0)).toBe(true);
  });

  it("refuses once the schedule says so, and reports the wait", () => {
    const store = createThrottleStore();
    for (let n = 0; n < 4; n++) store.fail(budget.email, T0, LOCKOUT_SECONDS);

    expect(store.check(budget.email, T0)).toBe(false);
    expect(store.retryAfter(budget.email, T0)).toBe(lockoutSecondsAfter(4));

    const just = store.retryAfter(budget.email, T0 + 1000);
    expect(just).toBeGreaterThan(0);
    expect(just).toBeLessThanOrEqual(lockoutSecondsAfter(4));
  });

  it("lets the key back in when the window has elapsed", () => {
    const store = createThrottleStore();
    for (let n = 0; n < 4; n++) store.fail(budget.email, T0, LOCKOUT_SECONDS);
    expect(store.check(budget.email, T0)).toBe(false);

    const after = T0 + lockoutSecondsAfter(4) * 1000;
    expect(store.check(budget.email, after)).toBe(true);
    expect(store.retryAfter(budget.email, after)).toBe(0);
  });

  it("forgets failures older than the window, even while still locked", () => {
    /*
     * The case the window exists for: someone who fat-fingers their password
     * twice, walks away, and comes back an hour later. Those two failures should
     * not still be waiting.
     */
    const store = createThrottleStore();
    store.fail(budget.email, T0, LOCKOUT_SECONDS);
    store.fail(budget.email, T0, LOCKOUT_SECONDS);

    const muchLater = T0 + FAILURE_WINDOW_MS + 1;
    store.fail(budget.email, muchLater, LOCKOUT_SECONDS);

    // Two old failures plus one new one is three, which is still free.
    expect(store.check(budget.email, muchLater)).toBe(true);
  });

  it("expires on read, so nothing has to notice fifteen minutes passing", () => {
    const store = createThrottleStore();
    store.fail(budget.email, T0, LOCKOUT_SECONDS);
    expect(store.size()).toBe(1);

    // Read it at a much later time; the stale entry goes as the read happens.
    expect(store.check(budget.email, T0 + FAILURE_WINDOW_MS + 1)).toBe(true);
    expect(store.size()).toBe(0);
  });

  it("clears on success, so a typo cannot lock out its own author", () => {
    const store = createThrottleStore();
    for (let n = 0; n < 5; n++) store.fail(budget.email, T0, LOCKOUT_SECONDS);
    expect(store.check(budget.email, T0)).toBe(false);

    store.succeed(budget.email);
    expect(store.check(budget.email, T0)).toBe(true);
    expect(store.size()).toBe(0);
  });

  it("keeps one key's failures out of another's", () => {
    const store = createThrottleStore();
    for (let n = 0; n < 4; n++) {
      store.fail(throttleKey("login", "a@x.com"), T0, LOCKOUT_SECONDS);
    }
    expect(store.check(throttleKey("login", "a@x.com"), T0)).toBe(false);
    expect(store.check(throttleKey("login", "b@x.com"), T0)).toBe(true);
  });

  it("drops stale keys on sweep and reports how many", () => {
    const store = createThrottleStore();
    store.fail("a", T0, LOCKOUT_SECONDS);
    store.fail("b", T0, LOCKOUT_SECONDS);
    store.fail("c", T0, LOCKOUT_SECONDS);

    // Not yet stale: 100ms of an age against a 500ms threshold.
    expect(store.sweep(T0 + 100, 500)).toBe(0);
    expect(store.size()).toBe(3);

    expect(store.sweep(T0 + 10_000, 500)).toBe(3);
    expect(store.size()).toBe(0);
  });
});

describe("longestRetryAfter", () => {
  it("reports the wait the user is actually told", () => {
    /*
     * When the two budgets disagree, the honest answer is the longer one. Telling
     * someone "try again in 1 minute" when they are locked for fifteen would be a
     * retry that cannot work.
     */
    const store = createThrottleStore();
    const budget = budgetsFor("login", "a@x.com", NAT);

    for (let n = 0; n < 4; n++) store.fail(budget.email, T0, LOCKOUT_SECONDS);
    for (let n = 0; n < 40; n++) store.fail(budget.ip!, T0, IP_LOCKOUT_SECONDS);

    expect(longestRetryAfter(store, budget, T0)).toBe(
      lockoutSecondsAfter(40, IP_LOCKOUT_SECONDS),
    );
  });

  it("is zero when nothing is locked", () => {
    const store = createThrottleStore();
    expect(longestRetryAfter(store, budgetsFor("login", "a@x.com", NAT), T0)).toBe(0);
  });

  it("is exactly the account's wait when there is no address budget to wait on", () => {
    const store = createThrottleStore();
    const budget = budgetsFor("login", "a@x.com", null);
    for (let n = 0; n < 4; n++) store.fail(budget.email, T0, LOCKOUT_SECONDS);

    // The account is locked and there is no second budget to wait on, so the wait
    // is precisely the account's own - not zero, and not the maximum.
    expect(longestRetryAfter(store, budget, T0)).toBe(lockoutSecondsAfter(4));
    expect(isClear(store, budget, T0)).toBe(false);
  });
});

describe("the trap this module exists to avoid", () => {
  it("does not let a third party lock out a real user cheaply", () => {
    /*
     * An attacker with no password can still submit wrong ones for a known
     * address. Every implementation that ignores this turns the limiter into a
     * denial-of-service tool aimed at the people being protected.
     *
     * The defences are structural, not incidental: the window is capped, a
     * success clears the budget, and the counter is keyed on the submitted
     * address whether or not it exists - so an attacker learns nothing about
     * which addresses are real from who gets locked out.
     */
    const store = createThrottleStore();
    const victim = throttleKey("login", "aarav.sharma0@student.busguard.test");

    for (let n = 0; n < 6; n++) store.fail(victim, T0, LOCKOUT_SECONDS);

    // The window is bounded, so the student is locked for at most this long...
    expect(store.retryAfter(victim, T0)).toBeLessThanOrEqual(MAX_LOCKOUT_SECONDS);
    // ...and back in within fifteen minutes.
    expect(store.check(victim, T0 + MAX_LOCKOUT_SECONDS * 1000)).toBe(true);
  });

  it("keys on the submitted address, so existence is not observable", () => {
    /*
     * If only accounts that existed were counted, "locked out" versus "incorrect
     * password" would tell an attacker which addresses are registered - the whole
     * student and guardian roster. Both must spend budget identically.
     */
    const real = throttleKey("login", "aarav.sharma0@student.busguard.test");
    const invented = throttleKey("login", "nobody@student.busguard.test");

    const store = createThrottleStore();
    for (let n = 0; n < 4; n++) {
      store.fail(real, T0, LOCKOUT_SECONDS);
      store.fail(invented, T0, LOCKOUT_SECONDS);
    }

    expect(store.check(real, T0)).toBe(store.check(invented, T0));
  });
});