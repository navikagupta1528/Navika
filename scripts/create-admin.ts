/**
 * Create (or repair) the administrator account.
 *
 * The public register form only creates STUDENT and PARENT accounts - that is
 * deliberate, otherwise anyone could register as an admin. The seed creates one
 * admin for a local demo, but a database deployed without seeding has no admin
 * at all, which is what "there is no admin login on the website" looks like.
 *
 *   npm run create:admin
 *
 * Configure with environment variables (all optional):
 *
 *   ADMIN_EMAIL     default admin@busguard.test
 *   ADMIN_USERNAME  default admin
 *   ADMIN_PASSWORD  default busguard123
 *   ADMIN_NAME      default Administrator
 *
 * Re-running it resets the password and re-activates the account, so it doubles
 * as the "I am locked out of the transport office" recovery path.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role } from "../src/generated/prisma/enums";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env first, or run npm run setup:db.",
  );
  process.exit(1);
}

const email = (process.env.ADMIN_EMAIL || "admin@busguard.test").trim().toLowerCase();
const username = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "busguard123";
const name = process.env.ADMIN_NAME || "Administrator";

if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // bcrypt at cost 12, matching src/lib/auth-password.ts. That module imports
  // `server-only`, which throws outside a React Server Component bundle, so the
  // script hashes directly instead of importing it.
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username,
      passwordHash,
      name,
      role: Role.ADMIN,
      isActive: true,
      mustChangePassword: false,
    },
    create: {
      email,
      username,
      passwordHash,
      name,
      role: Role.ADMIN,
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true, email: true, username: true, role: true },
  });

  console.log("\nAdmin account ready:");
  console.log(`  email    ${user.email}`);
  console.log(`  username ${user.username}`);
  console.log(`  password ${password}`);
  if (password === "busguard123") {
    console.log(
      "\n  ! That is the demo password. Change it (ADMIN_PASSWORD=... npm run create:admin)\n    before this instance is reachable by anyone else.",
    );
  }
  console.log("");
}

main()
  .catch((error: unknown) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";

    if (code === "P2022") {
      console.error(
        "\nThe database is missing the username/mustChangePassword columns.\n" +
          "Apply the migrations first:  npx prisma migrate deploy\n" +
          "(or run migration_username.sql against it by hand.)",
      );
    } else if (code === "P2002") {
      console.error(
        `\nThe username "${username}" is already used by another account.\n` +
          "Pick another one:  ADMIN_USERNAME=some-other-name npm run create:admin",
      );
    } else {
      console.error("\nCould not create the admin account:", error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
