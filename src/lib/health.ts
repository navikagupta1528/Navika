/**
 * Health-check decision logic, kept free of the database.
 *
 * This module exists so that the classification can be unit tested. The route
 * handler in `src/app/api/health/route.ts` cannot be: importing it constructs a
 * Prisma client, which reads DATABASE_URL at module scope, so the only way to
 * exercise the failure branches is to stand up a real broken database. That is
 * a manual experiment, not a test - nobody runs it, and the branch quietly rots.
 *
 * Everything here is pure. No Prisma, no fetch, no `import "server-only"`.
 */

/**
 * What the health check concluded about the database.
 *
 * Deliberately three states rather than a boolean, because they call for
 * different responses:
 *
 *   ok              serving traffic
 *   unreachable     the database is down, or the credentials are wrong. Retry.
 *   schema-missing  the database is up and answering, but our tables are not
 *                   there. Someone forgot to run `prisma migrate deploy`.
 *                   Retrying does nothing; this is the single most common way a
 *                   fresh deploy breaks, and it is invisible to a bare
 *                   `SELECT 1`, which is what most health checks run.
 */
export type DbState = "ok" | "timeout" | "unreachable" | "schema-missing";

/**
 * Error strings that mean "the relation does not exist".
 *
 * Three sources, because three different layers report it and we only ever see
 * one of them depending on which failed first:
 *
 *   "does not exist"  Postgres 42P01, surfaced in the driver's message text
 *   "42P01"           the raw SQLSTATE, in case a layer above rewrites the text
 *   "P2021"           Prisma's own code for "table does not exist"
 */
const MISSING_RELATION_MARKERS = ["does not exist", "42P01", "P2021"];

/** Flattens anything thrown into searchable text, defensively. */
function errorText(error: unknown): string {
  if (error instanceof Error) {
    // Include the cause chain: the useful SQLSTATE often sits one level below
    // the error Prisma actually threw, and stopping at the top level is how
    // this check ends up reporting `unreachable` for a missing table.
    const cause = (error as { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error
        ? ` ${cause.message}`
        : typeof cause === "string"
          ? ` ${cause}`
          : "";
    return `${error.message}${causeText}`;
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

/**
 * Decides what an error from the database probe actually means.
 *
 * The parameter is `hasDatabaseUrl` rather than reading `process.env` directly,
 * so the function stays pure and the "DATABASE_URL was never set" case can be
 * tested without mutating global state.
 *
 * Exported for the route handler; the tests are the reason it is separate.
 */
export function classifyDbError(error: unknown, hasDatabaseUrl: boolean): DbState {
  const text = errorText(error);

  if (MISSING_RELATION_MARKERS.some((marker) => text.includes(marker))) {
    return "schema-missing";
  }
  // Not really an error class at all, but it is the same operator instruction
  // either way: the schema was never applied, because there was nothing to
  // apply it to.
  if (!hasDatabaseUrl) return "schema-missing";

  return "unreachable";
}

/** HTTP status for a given state. Everything short of `ok` is unhealthy. */
export function statusForDbState(state: DbState): 200 | 503 {
  return state === "ok" ? 200 : 503;
}
