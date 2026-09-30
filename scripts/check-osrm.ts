/**
 * Manual check for the Phase 2 map data chain. Not part of `npm test` because it
 * reaches the network. Run with: npx tsx scripts/check-osrm.ts
 */
import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getRouteGeometry, getLegEta, getLiveEta, routeCacheKey } from "../src/lib/osrm";
import { isValidPoint, lineLengthMeters, viewportFor } from "../src/lib/geo";

let failures = 0;
function check(ok: boolean, label: string, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const route = await prisma.route.findFirst({
    where: { routeStops: { some: {} } },
    orderBy: { routeStops: { _count: "desc" } },
    select: {
      code: true,
      routeStops: {
        orderBy: { stopOrder: "asc" },
        select: { stop: { select: { name: true, lat: true, lng: true } } },
      },
    },
  });

  if (!route || route.routeStops.length < 2) {
    console.log("no seeded route with two or more stops; run npm run db:seed first");
    process.exit(1);
  }

  const points = route.routeStops.map((rs) => ({ lat: rs.stop.lat, lng: rs.stop.lng }));
  console.log(`route ${route.code}: ${points.length} stops`);

  check(
    points.every(isValidPoint),
    "every seeded stop has a coordinate a map will accept",
  );

  // Start from a cold cache, or this script only ever tests the warm path. The
  // warm path is exactly where a cache can quietly return the wrong *kind* of
  // answer, so it has to be reached deliberately rather than by accident.
  const key = routeCacheKey(points);
  await prisma.etaCache.deleteMany({ where: { cacheKey: key } });

  // --- Cold: fetched from OSRM -------------------------------------------
  const first = await getRouteGeometry(points);
  check(first !== null, "getRouteGeometry returns a result for a multi-stop route");

  if (first) {
    console.log(
      `      cold: source=${first.source} meters=${Math.round(first.meters)} seconds=${first.seconds} linePoints=${first.line.length}`,
    );

    check(first.meters > 0, "road distance is positive");
    check(first.seconds > 0, "duration is positive");

    if (first.source === "osrm") {
      check(
        first.line.length > points.length,
        "OSRM geometry has more points than stops, so it actually follows roads",
        `(${first.line.length} vs ${points.length})`,
      );
      check(
        first.line.every(isValidPoint),
        "every returned geometry point is a valid coordinate",
      );

      // The road distance must be at least the straight-line distance, and not
      // absurdly more. A ratio far outside this band means the geometry was
      // silently discarded and something else is being measured.
      const straight = lineLengthMeters(points);
      const ratio = first.meters / straight;
      check(
        ratio >= 1 && ratio < 2.5,
        "road distance is a plausible multiple of the straight line",
        `ratio=${ratio.toFixed(2)}`,
      );
    } else {
      console.log("      OSRM unreachable; verifying the straight-line fallback instead");
      check(
        first.line.length === points.length,
        "fallback returns the stop points unchanged",
      );
    }
  }

  // --- Cache ------------------------------------------------------------
  const cached = await prisma.etaCache.findUnique({ where: { cacheKey: key } });
  check(cached !== null, "the result was cached in EtaCache");
  check(
    cached !== null && Date.now() - cached.computedAt.getTime() < 60_000,
    "computedAt is stored as the real time it was computed",
  );

  const reversedKey = routeCacheKey(points.slice().reverse());
  check(
    reversedKey !== key,
    "reversing the stop order produces a different cache key",
  );

  // --- Warm: served from the cache ---------------------------------------
  //
  // The check that matters most. A cache that stores the distance but drops the
  // geometry renders real roads on the first load and straight lines on every
  // load after, while still captioning the figure as a road distance.
  const second = await getRouteGeometry(points);
  console.log(
    `      warm: source=${second?.source} meters=${Math.round(second?.meters ?? 0)} linePoints=${second?.line.length ?? 0}`,
  );

  check(second !== null, "the cached call returns a result");
  check(
    second?.source === first?.source,
    "a cached call reports the same source as the call that filled the cache",
  );

  if (first?.source === "osrm") {
    check(
      second !== null && second.line.length === first.line.length,
      "a cached call returns the same road geometry, not straight lines",
      `(${second?.line.length ?? 0} vs ${first.line.length} points)`,
    );
    check(
      second !== null &&
        second.meters === first.meters &&
        second.seconds === first.seconds,
      "a cached call returns the same distance and duration",
    );
    check(
      second !== null && second.line.every(isValidPoint),
      "cached geometry survives the round trip through the JSON column",
    );
  }

  // --- Legs -------------------------------------------------------------
  const leg = await getLegEta(points[0]!, points[1]!);
  check(leg.seconds > 0, `leg ETA is positive (${leg.seconds}s, ${leg.source})`);

  const here = await getLegEta(points[0]!, points[0]!);
  check(here.seconds === 0, "a bus already at the stop reports zero minutes, not one");

  const live = await getLiveEta(points[0]!, points[1]!);
  check(live.seconds >= 0, "live ETA is non-negative");

  // --- Viewport ---------------------------------------------------------
  const viewport = viewportFor(points, { center: { lat: 0, lng: 0 }, zoom: 3 });
  check(viewport.zoom > 10 && viewport.zoom <= 17, `framing zoom is sane (${viewport.zoom})`);
  check(isValidPoint(viewport.center), "framing centre is a valid coordinate");

  // Every stop should sit inside the viewport, or the map opens on a view that
  // hides part of the route it was asked to show.
  const { boundsOf } = await import("../src/lib/geo");
  const bounds = boundsOf(points)!;
  check(
    viewport.center.lat >= bounds.sw.lat && viewport.center.lat <= bounds.ne.lat,
    "the chosen centre falls inside the route's own bounding box",
  );

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  // Set the code rather than calling process.exit(). Forcing an exit while
  // libuv still holds closing handles trips an assertion in Windows' async
  // layer and reports a crash that did not happen.
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
