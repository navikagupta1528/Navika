/**
 * Prints the exact URLs worth opening for the Phase 2 map work, with the live
 * HTTP status of each.
 *
 * Run with: npm run map:tour
 *
 * This exists because the map is a client component: the server HTML cannot
 * prove the WebGL canvas mounts, so the most this can verify is that every page
 * renders and that the coordinates and distance caption reached the browser.
 * Opening the URLs it prints is the only way to see the tiles.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { login, resolveBase, visibleText, type Session } from "./lib/http";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BASE = resolveBase();
let allOk = true;

async function check(
  session: Session,
  label: string,
  path: string,
  needles: string[] = [],
): Promise<void> {
  const res = await session.get(path);

  if (res.status !== 200) {
    allOk = false;
    console.log(`FAIL  ${label}`);
    console.log(`      ${BASE}${path}`);
    console.log(`      status ${res.status}${res.location ? ` -> ${res.location}` : ""}`);
    return;
  }

  const text = visibleText(res.html);
  const missing = needles.filter((n) => !text.includes(n));
  if (missing.length > 0) allOk = false;

  console.log(`${missing.length ? "MISS" : "OK  "}  ${label}`);
  console.log(`      ${BASE}${path}`);
  console.log(
    `      200${missing.length ? `  missing: ${missing.join(", ")}` : needles.length ? "  all markers found" : ""}`,
  );
}

async function main() {
  const session = await login(BASE, "admin@busguard.test");

  console.log(`\n  BusGuard is running at ${BASE}`);
  console.log("  signed in as admin@busguard.test\n");

  const routes = await prisma.route.findMany({
    orderBy: { routeStops: { _count: "desc" } },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      _count: { select: { routeStops: true } },
    },
  });

  const stops = await prisma.stop.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true },
  });

  const bus = await prisma.bus.findFirst({ select: { id: true, busNumber: true } });

  console.log("  ROUTE MAPS   the Phase 2 work. Drag a numbered marker to reorder.\n");
  for (const route of routes) {
    await check(
      session,
      `${route.code}  ${route.name}  (${route._count.routeStops} stops)${route.isActive ? "" : "  INACTIVE"}`,
      `/admin/routes/${route.id}`,
      ["Route map", "Stop sequence", "Drag a numbered marker"],
    );
  }

  console.log("\n  STOP MAPS   one pin each, to check the location is on the right road\n");
  for (const stop of stops.slice(0, 3)) {
    await check(session, `${stop.name}${stop.isActive ? "" : "  (deactivated)"}`, `/admin/stops/${stop.id}`, [
      "Location",
      "Edit stop",
    ]);
  }

  console.log("\n  REST OF THE ADMIN AREA\n");
  for (const [label, path] of [
    ["Dashboard", "/admin"],
    ["Routes list", "/admin/routes"],
    ["Stops list", "/admin/stops"],
    ["Trips: scheduling and attendance", "/admin/trips"],
    ["Alerts", "/admin/alerts"],
    ["Reports", "/admin/reports"],
    ["Students and enrolments", "/admin/students"],
  ] as const) {
    await check(session, label, path);
  }
  if (bus) await check(session, `Bus ${bus.busNumber}`, `/admin/buses/${bus.id}`);

  console.log(
    allOk
      ? "\n  every page above returned 200 with its expected content\n"
      : "\n  some pages did not verify: see FAIL/MISS above\n",
  );
  process.exitCode = allOk ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
