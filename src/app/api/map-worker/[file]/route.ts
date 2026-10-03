/**
 * GET /api/map-worker/[file]
 *
 * Serves MapLibre's worker and its shared chunk out of the installed package.
 *
 * Read `src/lib/map-worker.ts` first: it explains why this route exists at all.
 * The short version is that MapLibre finds its worker as a *sibling* of its own
 * module URL, which no bundler preserves, and that fixing only the entry URL
 * leaves the worker's own import broken - the same console message either way.
 * This handler restores the sibling layout by serving every file from one
 * directory, so the relative import inside the worker resolves unchanged.
 *
 * Public on purpose, and not an oversight. The proxy only protects the portal
 * prefixes, `/api` is outside them, and the worker is open-source MapLibre
 * distributed by npm - there is nothing here worth gating, and gating it would
 * mean the map silently failing to draw on any screen a user reaches before
 * logging in. The health endpoint sets the precedent for `/api` being reachable
 * by a platform poller rather than a session.
 *
 * Nothing in a request reaches the filesystem unchecked: the filename comes from
 * a fixed allowlist in `@/lib/map-worker` and is used as one path segment under
 * one directory. No user-controlled string is ever concatenated into a path.
 */

import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  MAP_WORKER_CONTENT_TYPE,
  resolveMapWorkerFile,
} from "@/lib/map-worker";

/**
 * Re-read the file on every request.
 *
 * The alternative - letting Next cache the route - would bypass the conditional
 * GET below entirely, because a cached response is returned without the handler
 * running, so `If-None-Match` would never be looked at. Serving the file is a
 * single small read and the ETag keeps the wire cost at zero for repeat loads.
 */
export const dynamic = "force-dynamic";

/**
 * The package's `dist` directory.
 *
 * Seeded from the app root rather than from `import.meta.url`. That is not a
 * stylistic preference: in a bundled server route `import.meta.url` points into
 * the compiled output, not at the source tree, so a `createRequire` built on it
 * resolves against a directory with no `node_modules` above it and every lookup
 * fails. Seeding from `process.cwd()/package.json` asks the same question from
 * the one directory that is stable in every layout this app is started in - the
 * repo, the Render checkout, the Railway container.
 *
 * `require.resolve` still does the real work, so `exports` is honoured and the
 * install location is discovered rather than assumed. Building the path by hand
 * - `../../node_modules` a fixed number of times - would be correct for exactly
 * one layout and silently wrong for the rest, and on a deploy that is the
 * difference between a working map and a broken one.
 *
 * `MAP_WORKER_DIST` overrides the whole thing for anyone whose layout is
 * unusual enough that this cannot find it.
 */
function workerDistDir(): string {
  if (process.env.MAP_WORKER_DIST) return process.env.MAP_WORKER_DIST;
  const require = createRequire(join(process.cwd(), "package.json"));
  return join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
}

/**
 * A validator from size and mtime.
 *
 * Both files are replaced wholesale by a MapLibre upgrade, so the pair changes
 * together and any cheap fingerprint of "what is on disk right now" answers it.
 * Not a content hash: hashing 500 KB on every request to save a 304 is a bad
 * trade, and mtime already moved.
 */
function etagFor(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const resolved = resolveMapWorkerFile((await params).file);

  if (!resolved.ok) {
    // 404, not 400: from the outside this endpoint has exactly two states, and
    // which one you asked about is not information worth confirming.
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let body: Buffer;
  let size: number;
  let mtimeMs: number;
  try {
    const path = join(workerDistDir(), resolved.file);
    const info = await stat(path);
    body = await readFile(path);
    size = info.size;
    mtimeMs = info.mtimeMs;
  } catch (error) {
    // The name was on the allowlist but could not be read: `node_modules` was
    // installed with production dependencies only, pruned, laid out somewhere
    // `workerDistDir()` does not look, or the installed MapLibre dropped or
    // renamed the file.
    //
    // The cause is logged, not returned. The response stays vague on purpose -
    // this endpoint is public, and "could not resolve node_modules/maplibre-gl
    // from /app" is a map of the server's filesystem handed to any visitor. The
    // log is for whoever has to fix it, which is the only reader who needs it.
    console.error(
      `[map-worker] could not read ${resolved.file} from ${workerDistDir()}:`,
      error instanceof Error ? error.message : error,
    );
    return new Response("Worker file unavailable", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const etag = etagFor(size, mtimeMs);

  /*
   * Revalidate, never cache blind.
   *
   * `immutable` would be wrong here in a way that is easy to miss: these URLs
   * carry no version, so after a MapLibre upgrade they are unchanged while the
   * bytes behind them are not. A browser holding the old shared chunk would pair
   * a new worker with an old dependency, which fails at runtime with no useful
   * message. `must-revalidate` plus an ETag means the upgrade costs one 304.
   */
  const headers = {
    "Content-Type": MAP_WORKER_CONTENT_TYPE,
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: etag,
    // The worker is a module and inherits this origin; nothing here should ever
    // be framed or sniffed into something else.
    "X-Content-Type-Options": "nosniff",
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(new Uint8Array(body), { status: 200, headers });
}