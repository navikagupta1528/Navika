-- Login by roll number / username, and the forced first-login password change.
--
-- These two columns were added to prisma/schema.prisma with the "rollno login"
-- change, but no migration was ever committed for them: `migration_username.sql`
-- in the repo root is a captured Prisma CLI error, not SQL. Any database brought
-- up with `prisma migrate deploy` therefore has no "username" column, and the
-- login query (`WHERE email = ... OR username = ...`) fails with P2022 instead
-- of returning a user. That is the login breakage this migration fixes.
--
-- Written with IF NOT EXISTS because the deployed database may already have had
-- the columns added by hand. Prisma records this migration either way; the
-- statements simply become no-ops on a database that is already correct.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
