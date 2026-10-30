/**
 * Dashboard smoke test against a running BusGuard server.
 *
 *   npm run smoke:auth          # port from .env
 *   npm run smoke:auth 3010
 *
 * Logs in as each seeded demo account (real HTTP against the login Server
 * Action), then requests that role's dashboard with the returned cookie and
 * asserts it renders 200 with seeded data in the HTML.
 *
 * This catches the failure mode that unit tests miss: a dashboard whose query
 * throws at runtime because of a schema drift or a bad Prisma include.
 *
 * The HTTP plumbing - login, form replay, text extraction - comes from
 * `scripts/lib/http.ts`, shared with the other smoke scripts. This file used to
 * carry its own copy, and the copy was subtly different: it grabbed the *first*
 * form on the page rather than the one that is actually the sign-in form. That
 * only worked because the login page happens to render it first. When it stopped
 * doing so, the whole suite would have reported a wall of 307s and looked like
 * an application bug.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role } from "../src/generated/prisma/enums";
import { DEMO_PASSWORD, attemptLogin, login, resolveBase, visibleText } from "./lib/http";

const BASE = resolveBase();

/**
 * `mustContain` is a value that only appears if the dashboard actually read the
 * database, so a 200 with an empty shell still fails.
 */
const CASES: { role: Role; email: string; path: string; mustContain: string }[] = [
  { role: "ADMIN", email: "admin@busguard.test", path: "/admin", mustContain: "Fleet positions" },
  {
    role: "DRIVER",
    email: "driver1@busguard.test",
    path: "/driver",
    mustContain: "North-West Corridor",
  },
  { role: "PARENT", email: "parent1@busguard.test", path: "/parent", mustContain: "Aarav Sharma" },
  {
    role: "STUDENT",
    email: "aarav.sharma0@student.busguard.test",
    path: "/student",
    mustContain: "Suryanagar Chowk",
  },
];

function check(label: string, ok: boolean, detail = ""): number {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  return ok ? 1 : 0;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  let pass = 0;
  let fail = 0;
  // 3 per role, the forgery check, and 10 for the throttle (4 free attempts, the
  // refusal, and the per-account and clear-on-success behaviour).
  const total = CASES.length * 3 + 1 + 10;

  const record = (label: string, ok: boolean, detail = "") => {
    pass += check(label, ok, detail);
    if (!ok) fail += 1;
  };

  for (const c of CASES) {
    // Confirm the account exists and has the role we expect, so a bad seed is
    // reported as a seed failure rather than a confusing login failure.
    const user = await prisma.user.findUnique({ where: { email: c.email } });
    if (!user) {
      record(`${c.role}: seeded account ${c.email} does not exist`, false);
      continue;
    }
    if (user.role !== c.role) {
      record(`${c.role}: ${c.email} has role ${user.role} in the database`, false);
      continue;
    }

    // The shared `login` throws instead of returning null. Catching it here keeps
    // one bad account from aborting the suite and taking the other three with it.
    let session;
    try {
      session = await login(BASE, c.email, DEMO_PASSWORD);
    } catch (error) {
      record(
        `${c.role}: login sets a session cookie`,
        false,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }
    record(`${c.role}: login sets a session cookie`, true);

    const dash = await session.get(c.path);
    const text = visibleText(dash.html);

    record(`${c.role}: GET ${c.path}`, dash.status === 200, `-> ${dash.status}, ${dash.html.length} bytes`);
    record(
      `${c.role}: dashboard contains seeded data`,
      text.includes(c.mustContain),
      text.includes(c.mustContain) ? `found "${c.mustContain}"` : `missing "${c.mustContain}"`,
    );
  }

  // A tampered cookie must not authenticate, even with a valid-looking shape.
  const forged =
    Buffer.from(JSON.stringify({ userId: "x", role: "ADMIN" })).toString("base64url") +
    ".forged.forged";
  const res = await fetch(`${BASE}/admin`, {
    headers: { cookie: `busguard_session=${forged}` },
    redirect: "manual",
  });
  record(
    "forged cookie is rejected",
    res.status === 307 || res.status === 302 || res.status === 401,
    `-> ${res.status}`,
  );

  /*
   * Sign-in throttling, over the same HTTP path a browser takes.
   *
   * The 34 unit tests cover the schedule; this covers the wiring - that the action
   * consults the throttle, charges a failure on both budgets, charges one for an
   * address that does not exist as well as one that does, and clears on success.
   * A throttle with correct arithmetic that the action never calls is a comment.
   *
   * Asserting against the rendered message rather than a status code is the point
   * of doing this at HTTP level at all: "Too many failed attempts" and "Incorrect
   * email or password" are both a 200 with a form, and the difference between them
   * is the only thing a person experiences. It also requires `role="alert"` on the
   * message, which the auth forms did not have - so this suite is what proves the
   * screen reader fix landed rather than merely existing in the source.
   */
  const WRONG = "definitely-not-the-password";

  /** Every attempt in the run reported a wrong password, none reported a lock. */
  const allRejectedFreely = async (email: string, times: number) => {
    const messages: string[] = [];
    for (let n = 0; n < times; n++) {
      const a = await attemptLogin(BASE, email, WRONG);
      messages.push(a.message);
    }
    return messages.every((m) => /incorrect email or password/i.test(m));
  };

  /*
   * A fake address on purpose. Locking it costs nothing to leave behind, and it
   * is the only way to test that a rejection is charged *before* the account
   * lookup - if the throttle only counted accounts that exist, this address would
   * never lock and the assertion below would fail.
   */
  const absent = `throttle-probe-${process.pid}@busguard.test`;

  let stillWrong = true;
  for (let n = 1; n <= 4 && stillWrong; n++) {
    const a = await attemptLogin(BASE, absent, WRONG);
    stillWrong = /incorrect email or password/i.test(a.message);
    record(
      `attempt ${n} for an unknown address is a wrong password, not a lock`,
      stillWrong,
      `"${a.message}"`,
    );
  }

  // The fourth failure is what trips the schedule, so the fifth is the refusal.
  const locked = await attemptLogin(BASE, absent, WRONG);
  record(
    "attempt 5 for the same address is refused as throttled",
    /too many failed attempts/i.test(locked.message),
    `"${locked.message}"`,
  );

  /*
   * The refusal has to be per account. If it were global, one attacker posting
   * wrong passwords for one address would take down every user on the instance -
   * which is the same denial of service the schedule is designed to avoid, just
   * spelled differently.
   */
  const unaffected = await attemptLogin(BASE, CASES[1].email, DEMO_PASSWORD);
  record(
    "a locked address does not lock out a different one",
    Boolean(unaffected.cookie),
    `driver1 signed in: ${Boolean(unaffected.cookie)}`,
  );

  /*
   * A success clears the budget, so a typo cannot lock out its own author.
   *
   * Written as two rounds of three-then-correct rather than one, because a single
   * round cannot tell "the correct password worked" from "the budget was still
   * clear". The second round only reaches three free failures if the first round's
   * success actually reset the counter - and it ends on a success, so re-running
   * this suite starts from zero instead of compounding.
   */
  const target = CASES[1].email;

  record(
    "three failures stay inside the free allowance",
    await allRejectedFreely(target, 3),
  );

  const beforeClear = await attemptLogin(BASE, target, DEMO_PASSWORD);
  record("the correct password signs in while still free", Boolean(beforeClear.cookie));

  record(
    "a further three failures are free, so the success cleared the budget",
    await allRejectedFreely(target, 3),
  );

  const afterClear = await attemptLogin(BASE, target, DEMO_PASSWORD);
  record("the account signs in again, leaving no failures behind", Boolean(afterClear.cookie));

  await prisma.$disconnect();
  console.log(`\n${pass}/${total} checks passed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
