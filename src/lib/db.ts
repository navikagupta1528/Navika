import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/*
 * NOTE: no `import "server-only"` here, unlike most other modules in this
 * project. That marker package deliberately throws when it is loaded outside
 * React's `react-server` condition, and this module is also loaded by the
 * plain-Node custom server (server.ts -> src/server/socket.ts) to persist bus
 * positions. Nothing client-side imports this file — it is unreachable from the
 * browser bundle because every consumer is either a Server Component, a Server
 * Action, or Node.
 */

/**
 * Prisma 7 talks to Postgres through a driver adapter rather than a bundled
 * engine. The adapter owns the pg Pool, so we build it once and cache it on
 * globalThis to survive dev hot reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prismaAdapter?: PrismaPg;
  prisma?: PrismaClient;
};

function createAdapter() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Run `npm run setup:db`, or copy .env.example to .env.",
    );
  }
  return new PrismaPg({ connectionString });
}

const adapter = globalForPrisma.prismaAdapter ?? createAdapter();
const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaAdapter = adapter;
  globalForPrisma.prisma = prisma;
}

export { prisma };
