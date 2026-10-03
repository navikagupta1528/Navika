import { describe, expect, it } from "vitest";
import {
  MAP_WORKER_BASE,
  MAP_WORKER_FILES,
  mapWorkerEntryName,
  mapWorkerUrl,
  resolveMapWorkerFile,
} from "./map-worker";

/**
 * The worker is found by the browser, not by this app's code, so none of this is
 * reachable from the unit suite - a passing test here does not prove a tile
 * draws. What it does protect is the part that *is* ours: the allowlist that
 * stands between a request parameter and a filesystem path, and the sibling
 * layout the worker's own import depends on.
 *
 * The bug being guarded against is real and shipped once already. Pointing
 * `setWorkerUrl` at the asset Turbopack emitted fixed the entry URL and left the
 * worker's `import "./maplibre-gl-shared.mjs"` pointing at a file that was hashed
 * under another name, so it failed with the identical console message and looked
 * like the fix had done nothing.
 */

describe("mapWorkerEntryName", () => {
  it("uses the unminified worker in development, matching MapLibre's own rule", () => {
    expect(mapWorkerEntryName(true)).toBe("maplibre-gl-worker-dev.mjs");
  });

  it("uses the minified worker in production", () => {
    expect(mapWorkerEntryName(false)).toBe("maplibre-gl-worker.mjs");
  });
});

describe("mapWorkerUrl", () => {
  it("puts the entry point inside the served directory", () => {
    expect(mapWorkerUrl(false)).toBe(`${MAP_WORKER_BASE}/maplibre-gl-worker.mjs`);
  });

  it("resolves the worker's relative import as a sibling of the entry point", () => {
    /*
     * This is the assertion that would have caught the bug. MapLibre's worker
     * opens with `import ... from "./maplibre-gl-shared.mjs"`, which the browser
     * resolves against the entry URL's *directory*. If the directory ever stops
     * being one the handler serves every file from, the entry loads and then
     * dies on its own dependency - reported as a worker URL problem, which is
     * the most misleading possible reading.
     */
    const entry = new URL(mapWorkerUrl(false), "https://example.test");
    const sibling = new URL("./maplibre-gl-shared.mjs", entry);
    expect(sibling.pathname).toBe(`${MAP_WORKER_BASE}/maplibre-gl-shared.mjs`);
  });

  it("serves the dev worker's own sibling, which has a different name", () => {
    const entry = new URL(mapWorkerUrl(true), "https://example.test");
    const sibling = new URL("./maplibre-gl-shared-dev.mjs", entry);
    expect(sibling.pathname).toBe(`${MAP_WORKER_BASE}/maplibre-gl-shared-dev.mjs`);
  });

  it("only ever names a file the handler will serve", () => {
    for (const dev of [true, false]) {
      const file = mapWorkerEntryName(dev);
      expect(MAP_WORKER_FILES.has(file)).toBe(true);
    }
  });
});

describe("resolveMapWorkerFile", () => {
  it("accepts each file the worker pair needs", () => {
    for (const file of MAP_WORKER_FILES) {
      expect(resolveMapWorkerFile(file)).toEqual({ ok: true, file });
    }
  });

  it("rejects anything not on the list, however it is spelled", () => {
    // Exact match, not prefix or extension. This handler reads from a path built
    // out of a request parameter; the allowlist is the only thing between that
    // and the filesystem.
    for (const name of [
      "../../../../package.json",
      "..%2F..%2F.env",
      "maplibre-gl-shared.mjs.map",
      "MAPLIBRE-GL-WORKER.MJS",
      "maplibre-gl-shared.mjs ",
      " maplibre-gl-shared.mjs",
    ]) {
      expect(resolveMapWorkerFile(name).ok).toBe(false);
    }
  });

  it("rejects a missing name rather than defaulting to something", () => {
    // A default here would be a file served by accident. "No file named" is the
    // honest answer to a request that named nothing.
    expect(resolveMapWorkerFile(undefined).ok).toBe(false);
    expect(resolveMapWorkerFile("").ok).toBe(false);
  });

  it("explains a refusal, since the route answers with it", () => {
    const result = resolveMapWorkerFile("secrets.env");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("secrets.env");
  });
});