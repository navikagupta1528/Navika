/**
 * GET /api/health - the endpoint a container platform polls.
 *
 * Public on purpose: Render, a load balancer and any uptime monitor all need to
 * reach it before anyone has logged in. The proxy matcher already excludes
 * `/api`, so nothing here needs to opt out of a redirect.
 *
 * Two questions get answered separately, because they have different meanings:
 *
 *   is the process up?          -> it answered
 *   can it actually do its job? -> it can reach Postgres AND the schema is applied
 *
 * A bare `SELECT 1` conflates those. The single most common way a fresh deploy
 * goes wrong is the container starting fine against a database that never had
 * `prisma migrate deploy` run, and `SELECT 1` reports that perfectly healthy.
 * So the schema gets touched too - a tiny indexed count, not a table scan.
 *
 * The classification of failures lives in `@/lib/health` rather than here, so it
 * can be unit tested without standing up a broken database.
 *
 * Everything returned is safe to show an operator. No connection string, no
 * DSN, no error stack, no row data. A health endpoint ends up in deploy logs
 * that are often world-readable, and a leaked DATABASE_URL in one is a real
 * incident.
 */

import { prisma } from "@/lib/db";
import { classifyDbError, statusForDbState, type DbState } from "@/lib/health";
import { shouldAttachRedisAdapter } from "@/lib/realtime-scaling";

export const dynamic = "force-dynamic";

/** Postgres may hang rather than refuse. Do not let that stall the poller. */
const DB_TIMEOUT_MS = 3_000;

async function checkDatabase(): Promise<DbState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      (async () => {
        await prisma.$queryRaw`SELECT 1`;
        // Proves the connection is not merely alive but that our tables are
        // there. `take: 1` keeps this an index scan however many buses there are.
        await prisma.bus.count({ take: 1 });
        return "ok" as DbState;
      })(),
      new Promise<DbState>((resolve) => {
        timer = setTimeout(() => resolve("timeout"), DB_TIMEOUT_MS);
      }),
    ]);
    return result;
  } catch (error) {
    return classifyDbError(error, Boolean(process.env.DATABASE_URL));
  } finally {
    // Clear on both paths. Leaving the timer armed would keep the event loop
    // alive for another 3 seconds after every check, which a poller every 30
    // seconds would turn into a steadily growing pile of pending callbacks.
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const startedAt = Date.now();
  const db = await checkDatabase();

  return Response.json(
    {
      ok: db === "ok",
      db,
      /*
       * Which broadcast mode this instance is in.
       *
       * Worth reporting because the failure it guards against is invisible: two
       * instances without a shared adapter each look perfectly healthy while
       * half of every fleet watches a frozen map. An operator who can read
       * "single-instance" here from a load-balanced deployment knows why.
       */
      realtime: shouldAttachRedisAdapter(process.env.REDIS_URL) ? "redis" : "single-instance",
      // Seconds, not a timestamp. Uptime is what tells an operator whether this
      // container has just restarted, which is the usual reason to be looking.
      uptime: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
    },
    {
      // Never cached. A cached 200 is the worst possible failure mode here: the
      // platform keeps serving the instance it should have replaced.
      headers: { "Cache-Control": "no-store" },
      status: statusForDbState(db),
    },
  );
}
