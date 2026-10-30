/**
 * Whether this process should join a shared Socket.IO adapter.
 *
 * One server process broadcasts to its own clients for free. The moment there
 * are two - a rolling deploy, two containers, a load balancer - they stop being
 * one fleet: a driver connected to instance A moves a bus, and a parent
 * connected to instance B never hears about it, because the broadcast never left
 * A. The pages all render, the map stays blank, and nothing logs an error, which
 * is the worst shape a bug can take.
 *
 * The fix is a Redis adapter, the standard Socket.IO answer for this. It is
 * opt-in here, because the single-instance deployment this project actually
 * ships (`render.yaml` pins `numInstances: 1`) should not be made to run Redis it
 * does not need. With `REDIS_URL` unset, everything behaves exactly as it did.
 */

/**
 * A usable Redis connection string, or null.
 *
 * Validated rather than taken on faith: `ioredis://...` or a stray `postgres://`
 * pasted into the wrong variable would otherwise fail inside a dynamic import at
 * boot, and "the realtime server silently fell back to single-instance" is much
 * harder to notice than a rejected config value.
 */
export function redisAdapterUrl(configured: string | undefined): string | null {
  const value = configured?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "redis:" || url.protocol === "rediss:" ? value : null;
  } catch {
    return null;
  }
}

/** Should the socket server attach the Redis adapter? */
export function shouldAttachRedisAdapter(configured: string | undefined): boolean {
  return redisAdapterUrl(configured) !== null;
}

/**
 * What to print at boot, so "am I in multi-instance mode" is answerable from the
 * logs rather than by reading the source.
 */
export function scalingNotice(configured: string | undefined): string {
  return shouldAttachRedisAdapter(configured)
    ? "realtime: Redis adapter configured — broadcasts shared across instances"
    : "realtime: single-instance (set REDIS_URL to share broadcasts across instances)";
}
