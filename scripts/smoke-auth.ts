/**
 * Dashboard smoke test against a running Navika server.
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
import { DEMO_PASSWORD, login, resolveBase, visibleText } from "./lib/http";

const BASE = resolveBase();

/**
 * `mustContain` is a value that only appears if the dashboard actually read the
 * database, so a 200 with an empty shell still fails.
 */
const CASES: { role: Role; email: string; path: string; mustContain: string }[] = [
  { role: "ADMIN", email: "admin@navika.test", path: "/admin", mustContain: "Fleet positions" },
  {
    role: "DRIVER",
    email: "driver1@navika.test",
    path: "/driver",
    mustContain: "North-West Corridor",
  },
  { role: "PARENT", email: "parent1@navika.test", path: "/parent", mustContain: "Aarav Sharma" },
  {
    role: "STUDENT",
    email: "aarav.sharma0@student.navika.test",
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
  // 3 checks per role, plus the forgery check.
  const total = CASES.length * 3 + 1;

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
    headers: { cookie: `navika_session=${forged}` },
    redirect: "manual",
  });
  record(
    "forged cookie is rejected",
    res.status === 307 || res.status === 302 || res.status === 401,
    `-> ${res.status}`,
  );

  await prisma.$disconnect();
  console.log(`\n${pass}/${total} checks passed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
