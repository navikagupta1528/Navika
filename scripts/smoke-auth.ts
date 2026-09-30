/**
 * Dashboard smoke test against a running Navika server.
 *
 *   npm run smoke:auth 3010
 *
 * Logs in as each seeded demo account (real HTTP against the login Server
 * Action), then requests that role's dashboard with the returned cookie and
 * asserts it renders 200 with seeded data in the HTML.
 *
 * This catches the failure mode that unit tests miss: a dashboard whose query
 * throws at runtime because of a schema drift or a bad Prisma include.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role } from "../src/generated/prisma/enums";

const PORT = process.argv[2] ?? process.env.PORT ?? "3000";
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * `mustContain` is a value that only appears if the dashboard actually read the
 * database, so a 200 with an empty shell still fails.
 */
const CASES: { role: Role; email: string; path: string; mustContain: string }[] =
  [
    { role: "ADMIN", email: "admin@navika.test", path: "/admin", mustContain: "Fleet positions" },
    { role: "DRIVER", email: "driver1@navika.test", path: "/driver", mustContain: "North-West Corridor" },
    { role: "PARENT", email: "parent1@navika.test", path: "/parent", mustContain: "Aarav Sharma" },
    {
      role: "STUDENT",
      email: "aarav.sharma0@student.navika.test",
      path: "/student",
      mustContain: "Suryanagar Chowk",
    },
  ];

let prisma: PrismaClient;

/** Strip tags and decode entities so we match what a user actually reads. */
function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, " "),
  );
}

async function check(label: string, ok: boolean, detail = ""): Promise<number> {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  return ok ? 1 : 0;
}

/** Decode the HTML entities React puts in hidden input values. */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Log in the same way a browser without JavaScript would.
 *
 * Next renders the Server Action as a plain HTML form: the action id and bound
 * arguments travel in hidden `$ACTION_*` inputs, and the POST goes to the same
 * URL with no `next-action` header. Replaying those exact fields is what makes
 * this test exercise the same code path as a real form submission.
 */
async function login(email: string, password: string): Promise<string | null> {
  const page = await fetch(`${BASE}/login`);
  if (!page.ok) return null;
  const html = await page.text();

  const formMatch = html.match(/<form[^>]*>([\s\S]*?)<\/form>/);
  if (!formMatch) return null;
  const form = formMatch[0];

  const body = new FormData();
  const hidden = /<input[^>]*type="hidden"[^>]*>/g;
  for (const tag of form.match(hidden) ?? []) {
    const name = decodeEntities(tag.match(/name="([^"]*)"/)?.[1] ?? "");
    if (!name.startsWith("$ACTION")) continue;
    const value = decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? "");
    body.set(name, value);
  }

  body.set("email", email);
  body.set("password", password);

  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    body,
    redirect: "manual",
  });

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const session = setCookies.find((h) => h.startsWith("navika_session="));
  return session?.split(";")[0] ?? null;
}

async function main() {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  let pass = 0;
  const total = CASES.length * 3 + 1; // 3 checks per role, plus the forgery check.

  for (const c of CASES) {
    // Confirm the account exists and has the role we expect, so a bad seed is
    // reported as a seed failure rather than a confusing login failure.
    const user = await prisma.user.findUnique({ where: { email: c.email } });
    if (!user) {
      console.log(`FAIL  ${c.role}: seeded account ${c.email} does not exist`);
      continue;
    }
    if (user.role !== c.role) {
      console.log(`FAIL  ${c.role}: ${c.email} has role ${user.role} in the database`);
      continue;
    }

    const cookie = await login(c.email, "navika123");
    if (!cookie) {
      console.log(`FAIL  ${c.role}: login did not return a session cookie`);
      continue;
    }
    pass += await check(`${c.role}: login sets a session cookie`, true);

    const dash = await fetch(`${BASE}${c.path}`, {
      headers: { cookie },
      redirect: "manual",
    });
    const html = await dash.text();
    const text = visibleText(html);

    pass += await check(
      `${c.role}: GET ${c.path}`,
      dash.status === 200,
      `-> ${dash.status}, ${html.length} bytes`,
    );
    pass += await check(
      `${c.role}: dashboard contains seeded data`,
      text.includes(c.mustContain),
      text.includes(c.mustContain)
        ? `found "${c.mustContain}"`
        : `missing "${c.mustContain}"`,
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
  pass += await check(
    "forged cookie is rejected",
    res.status === 307 || res.status === 302 || res.status === 401,
    `-> ${res.status}`,
  );

  await prisma.$disconnect();
  console.log(`\n${pass}/${total} checks passed`);
  if (pass < total) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
