/**
 * The MapLibre worker, and how the browser is meant to reach it.
 *
 * Pure by design: filenames, the whitelist and the entry-point choice, with no
 * filesystem and no network. The route that serves the bytes lives in
 * `src/app/api/map-worker/[file]/route.ts` and does the reading; everything
 * that decides *what* may be read is here, where it can be unit tested.
 *
 * WHY THIS EXISTS
 * ---------------
 * MapLibre locates its worker like this:
 *
 *   new URL("./maplibre-gl-worker.mjs", import.meta.url)
 *
 * which assumes the library and its worker sit side by side on the same server
 * path. That is true when a package directory is served as-is. It is false under
 * any bundler, because a bundler rewrites module references and does not
 * preserve the sibling relationship that this arithmetic depends on.
 *
 * Under Turbopack the file *is* emitted - so it looks like this should work -
 * but to `/_next/static/media/maplibre-gl-worker.<hash>.mjs`, while the runtime
 * concatenation asks for `/_next/static/chunks/maplibre-gl-worker.mjs`. Two
 * problems, in order of how easily they are missed:
 *
 *   1. Wrong directory. Turbopack hashes assets into `media/`, and the chunk
 *      that did the concatenation lives in `chunks/`. The URL the runtime
 *      computes does not exist. (404)
 *
 *   2. Broken import inside the file. This is the one that survives fixing the
 *      first. The emitted worker opens with
 *
 *         import { ... } from "./maplibre-gl-shared.mjs";
 *
 *      left exactly as MapLibre wrote it. The shared chunk was bundled under a
 *      *different* hashed name, so nothing in `media/` answers to the
 *      unhashed name the import asks for. The worker entry loads, then dies
 *      resolving its own dependency. (404 on the import)
 *
 * Both surface as the same one-line console message, which is what makes this
 * hard to diagnose from the symptom alone:
 *
 *   Worker failed to load. Check that the worker URL is correct.
 *
 * "Check that the worker URL is correct" is true and useless: the URL was
 * correct. Pointing `setWorkerUrl` at the hashed asset fixes (1) and leaves (2)
 * untouched, so it is very easy to conclude the approach failed when the
 * approach was half right.
 *
 * THE FIX
 * -------
 * Serve the pair from the installed package, at one URL per file, so the
 * worker's relative import resolves as a sibling of the entry point. That is
 * the layout MapLibre's own arithmetic was written against, so it works
 * unchanged - no rewriting of the emitted file, no assumptions about what the
 * bundler will hash things to, identical behaviour in dev and in production.
 *
 * Read from `node_modules` at request time rather than copied into `public/` at
 * build time. A vendored copy is a file that goes stale: upgrade MapLibre, and
 * the copied worker is last release's, with no error to tell you. Reading the
 * installed package cannot drift from it.
 */

/**
 * Where these files are served from, and therefore the URL MapLibre is pointed
 * at.
 *
 * The trailing-slash shape matters: the worker's `import "./maplibre-gl-shared.mjs"`
 * resolves against the *directory* of the entry URL, so this must be a directory
 * the handler serves several files from, not a single-file endpoint.
 */
export const MAP_WORKER_BASE = "/api/map-worker";

/**
 * Every file this app is willing to serve.
 *
 * An exact-match allowlist, not a prefix or an extension test. This handler
 * reads from a path built out of request input, and the only thing standing
 * between a request and the filesystem is this set. `Object.hasOwn` against a
 * plain object would also work, but a `Set` says "these names and no others" more
 * directly at the call site.
 *
 * Each entry imports exactly one sibling, and each sibling is self-contained:
 *
 *   maplibre-gl-worker.mjs      -> ./maplibre-gl-shared.mjs
 *   maplibre-gl-worker-dev.mjs  -> ./maplibre-gl-shared-dev.mjs
 *
 * Both pairs ship in the package, which is the whole reason serving the pair
 * works. The dev pair is 1.2 MB unminified and is only ever requested by a dev
 * server.
 */
export const MAP_WORKER_FILES: ReadonlySet<string> = new Set([
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
  "maplibre-gl-worker-dev.mjs",
  "maplibre-gl-shared-dev.mjs",
]);

/**
 * The file to load as the worker entry point.
 *
 * Mirrors MapLibre's own rule, which picks the `-dev` build when it is running
 * against a `-dev` bundle and the minified one otherwise. Overriding the URL
 * means also choosing the variant; taking the minified worker everywhere would
 * be smaller and would work, but a stack trace out of a worker is already hard
 * to read and there is no reason to make it worse in the one environment whose
 * entire purpose is telling you what went wrong.
 */
export function mapWorkerEntryName(dev: boolean): string {
  return dev ? "maplibre-gl-worker-dev.mjs" : "maplibre-gl-worker.mjs";
}

/** The full URL to hand to `setWorkerUrl`. */
export function mapWorkerUrl(dev: boolean): string {
  return `${MAP_WORKER_BASE}/${mapWorkerEntryName(dev)}`;
}

export type MapWorkerFile =
  | { ok: true; file: string }
  | { ok: false; reason: string };

/**
 * Decide whether a requested path segment may be served.
 *
 * Returns a value rather than a boolean so the route can answer a stranger with
 * a reason. The distinction is worth keeping in the type: "not on the list" is a
 * permanent answer and "the file is not there" is a broken install, and they
 * call for different fixes.
 *
 * Note what is *not* here: no `path.join`, no normalisation, no traversal check.
 * The name is only ever used as a single path segment under a fixed directory
 * after an exact-match test, so there is no string to make escape from. Adding
 * traversal handling to a value that provably cannot contain a separator would
 * be a check against a hypothetical rather than a threat.
 */
export function resolveMapWorkerFile(name: string | undefined): MapWorkerFile {
  if (!name) {
    return { ok: false, reason: "no file named" };
  }
  if (!MAP_WORKER_FILES.has(name)) {
    return { ok: false, reason: `"${name}" is not a MapLibre worker file` };
  }
  return { ok: true, file: name };
}

/**
 * Content type for a served worker.
 *
 * `application/javascript` and nothing else. A worker is loaded with
 * `new Worker(url, { type: "module" })`, and if the response arrives as
 * `text/html` the browser refuses it with a MIME error that points at the
 * server rather than at MapLibre's URL arithmetic - which, given how long that
 * took to find, is a poor place to send someone.
 */
export const MAP_WORKER_CONTENT_TYPE = "application/javascript; charset=utf-8";