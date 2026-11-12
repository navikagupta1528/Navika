/**
 * Verify the username migration against a database that looks like a deployed
 * one: the eight older migrations applied and recorded in _prisma_migrations,
 * real rows present, no username column yet.
 *
 *   node scripts/verify-deploy-migration.mjs
 *
 * It creates a throwaway database next to the local one, replays the committed
 * migration.sql files in order up to the new one (recording them in
 * _prisma_migrations the way Prisma does), inserts a user, then runs
 * `prisma migrate deploy` and checks the result. The scratch database is dropped
 * at the end.
 *
 * This is the scenario that broke in production: `prisma migrate deploy` on an
 * existing database, not `migrate dev` on an empty one.
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const SCRATCH = "busguard_deploy_check";
const NEW_MIGRATION = "20261112000000_add_username_and_must_change_password";

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is not set");

function withDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const adminUrl = withDatabase(base, "postgres");
const scratchUrl = withDatabase(base, SCRATCH);

async function run(sqlUrl, statement, params = []) {
  const client = new Client({ connectionString: sqlUrl });
  await client.connect();
  try {
    return await client.query(statement, params);
  } finally {
    await client.end();
  }
}

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// Prisma's bookkeeping table, so `migrate deploy` believes the older
// migrations were applied by Prisma rather than finding a non-empty schema.
const LEDGER_DDL = `
  CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
  )`;

try {
  // ---------------------------------------------------------------- setup
  await run(adminUrl, `DROP DATABASE IF EXISTS "${SCRATCH}"`);
  await run(adminUrl, `CREATE DATABASE "${SCRATCH}"`);
  console.log(`scratch database ${SCRATCH} created`);

  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  const dirs = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const older = dirs.filter((d) => d !== NEW_MIGRATION);
  console.log(`replaying ${older.length} older migration(s)`);

  await run(scratchUrl, LEDGER_DDL);
  for (const dir of older) {
    const sql = await readFile(join(migrationsDir, dir, "migration.sql"), "utf8");
    await run(scratchUrl, sql);
    await run(
      scratchUrl,
      `INSERT INTO "_prisma_migrations"
         ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
       VALUES ($1, $2, now(), $3, 1)`,
      [randomUUID(), createHash("sha256").update(sql).digest("hex"), dir],
    );
  }

  // A user row that existed before the migration, like a real deployment.
  await run(
    scratchUrl,
    `INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "createdAt", "updatedAt")
     VALUES ('legacy-user-1', 'old.admin@busguard.test', 'Old Admin', 'x', 'ADMIN', now(), now())`,
  );

  const before = await run(
    scratchUrl,
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'User' AND column_name IN ('username', 'mustChangePassword')`,
  );
  check("before: username column is absent", before.rowCount === 0, `found ${before.rowCount}`);

  // ------------------------------------------------------------- the deploy
  console.log("\nrunning prisma migrate deploy ...");
  const deploy = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: scratchUrl },
    shell: true,
    encoding: "utf8",
  });
  process.stdout.write(deploy.stdout || "");
  process.stderr.write(deploy.stderr || "");
  check("prisma migrate deploy exits 0", deploy.status === 0, `exit ${deploy.status}`);

  // ------------------------------------------------------------ assertions
  const after = await run(
    scratchUrl,
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'User' AND column_name IN ('username', 'mustChangePassword')`,
  );
  const names = after.rows.map((r) => r.column_name);
  check("after: username column exists", names.includes("username"));
  check("after: mustChangePassword column exists", names.includes("mustChangePassword"));

  const legacy = await run(
    scratchUrl,
    `SELECT "username", "mustChangePassword" FROM "User" WHERE "id" = 'legacy-user-1'`,
  );
  check(
    "existing user row survived with mustChangePassword = false",
    legacy.rowCount === 1 && legacy.rows[0].mustChangePassword === false,
    JSON.stringify(legacy.rows[0] ?? null),
  );

  // The login query the app actually issues.
  const login = await run(
    scratchUrl,
    `SELECT "id" FROM "User" WHERE "email" = 'old.admin@busguard.test' OR "username" = 'old.admin@busguard.test'`,
  );
  check("login query no longer throws and finds the user", login.rowCount === 1);

  // Re-running must be harmless.
  console.log("\nrunning prisma migrate deploy a second time ...");
  const again = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: scratchUrl },
    shell: true,
    encoding: "utf8",
  });
  check("second deploy exits 0", again.status === 0, `exit ${again.status}`);
  check("second deploy applies nothing", /No pending migrations/i.test(again.stdout || ""));
} finally {
  await run(adminUrl, `DROP DATABASE IF EXISTS "${SCRATCH}"`).catch(() => {});
  console.log(`\nscratch database ${SCRATCH} dropped`);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
