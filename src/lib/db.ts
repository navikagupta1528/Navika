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

let cached: PrismaClient | undefined;

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Run `npm run setup:db`, or copy .env.example to .env.",
    );
  }
  const adapter = globalForPrisma.prismaAdapter ?? new PrismaPg({ connectionString });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prismaAdapter = adapter;
  }
  return new PrismaClient({ adapter });
}

function client(): PrismaClient {
  if (cached) return cached;
  if (globalForPrisma.prisma) {
    cached = globalForPrisma.prisma;
    return cached;
  }
  cached = createClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = cached;
  }
  return cached;
}

/**
 * Built lazily on first use, not at module scope.
 *
 * `next build` imports every route module to collect its configuration, which
 * means a module-scope client is constructed on the build machine. That made a
 * hosted build require a live `DATABASE_URL` — a build-time secret with no
 * build-time consumer — and a clean checkout failed before a single page was
 * rendered. A query still needs the URL; merely importing this module does not.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
