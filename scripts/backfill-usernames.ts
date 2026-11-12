/**
 * Fill in User.username for accounts that predate the username migration.
 *
 *   npm run users:backfill           # show what would change
 *   npm run users:backfill -- --apply
 *
 * The login form accepts an email, a username, or a student roll number, but the
 * username column only started being populated when it was added to the schema.
 * Accounts created before that have username = NULL, so a student cannot sign in
 * with their roll number and staff cannot use a short name - even though the
 * login screen advertises both. This walks the existing rows once and derives a
 * username:
 *
 *   STUDENT  -> StudentProfile.enrollmentNo, lower-cased (the roll number)
 *   others   -> the part of the email before "@", lower-cased
 *
 * It is idempotent: rows that already have a username are left alone, and a
 * derived name that collides with an existing one is reported and skipped rather
 * than failing the whole run.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role } from "../src/generated/prisma/enums";

const apply = process.argv.includes("--apply");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function derive(email: string, role: Role, enrollmentNo: string | null) {
  if (role === Role.STUDENT && enrollmentNo) {
    return enrollmentNo.trim().toLowerCase();
  }
  const local = email.split("@")[0]?.trim().toLowerCase() ?? "";
  return local;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { username: null },
    select: {
      id: true,
      email: true,
      role: true,
      studentProfile: { select: { enrollmentNo: true } },
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  const taken = new Set(
    (
      await prisma.user.findMany({
        where: { username: { not: null } },
        select: { username: true },
      })
    ).map((u) => u.username as string),
  );

  console.log(
    `${users.length} account(s) without a username.` +
      (apply ? "" : " Dry run - pass --apply to write."),
  );

  let changed = 0;
  const skipped: string[] = [];

  for (const user of users) {
    const username = derive(
      user.email,
      user.role,
      user.studentProfile?.enrollmentNo ?? null,
    );

    if (!username) {
      skipped.push(`${user.email} (nothing to derive)`);
      continue;
    }
    if (taken.has(username)) {
      skipped.push(`${user.email} ("${username}" already used)`);
      continue;
    }

    if (!apply) {
      console.log(`  would set ${user.role.padEnd(7)} ${user.email} -> ${username}`);
      taken.add(username);
      changed += 1;
      continue;
    }

    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { username },
      });
      taken.add(username);
      changed += 1;
      console.log(`  ${user.role.padEnd(7)} ${user.email} -> ${username}`);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      skipped.push(
        `${user.email} (${code === "P2002" ? "username taken" : "update failed"})`,
      );
    }
  }

  console.log(
    apply
      ? `\nUpdated ${changed}, skipped ${skipped.length}.`
      : `\nWould update ${changed}, skipped ${skipped.length}.`,
  );
  for (const line of skipped) console.log(`  skipped: ${line}`);
}

main()
  .catch((error: unknown) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
