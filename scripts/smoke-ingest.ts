/**
 * Device ingestion smoke test: a hardware tracker reporting a bus position.
 *
 *   npm run smoke:ingest
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
 *
 * The admission rules - how often a device may ping, when a fix is too old to
 * believe - are pure and covered by `src/lib/device-ingest.test.ts` and
 * `src/lib/tracking.test.ts`. What that cannot check is the part that actually
 * fails in production: that the bearer token is looked up by hash, that a revoked
 * token stops working the instant it is revoked, that a rejected ping really is
 * refused at the HTTP boundary rather than only in the library, and that an
 * accepted ping writes the same bus row the driver's phone writes.
 *
 * It POSTs to the real endpoint against the live server and the live cluster, and
 * rolls back everything it wrote.
 *
 *   npm run db:start          # if the machine has rebooted
 *   npm run build && npm start # the suite runs against production on PORT
 *   npm run smoke:ingest
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { generateDeviceToken, hashDeviceToken } from "../src/lib/device-token";
import { resolveBase } from "./lib/http";

const BASE = resolveBase();
const PATH = `${BASE}/api/ingest/location`;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;

function report(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send one report as a tracker would.
 *
 * `body` is passed through `JSON.stringify` unless it is already a string, so a
 * test can send a malformed body deliberately.
 */
async function post(body: unknown, token: string | null, raw = false): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(PATH, {
    method: "POST",
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

/**
 * A position nowhere near a stop.
 *
 * Deliberately far from the seeded routes: an accepted ping runs the geofence,
 * boarding and driving watchers, and a coordinate next to a stop would create a
 * `StopApproach` ring and potentially a notification that this test did not mean
 * to send. The guards in `runTripWatchers` should not need to be trusted by a
 * test that only wants to know whether the endpoint accepts a token - so it gives
 * them nothing to fire on.
 */
const OFF_ROUTE = { lat: 10.0001, lng: 10.0001 };

async function main() {
  console.log("\nDevice ingestion smoke test\n");

  const bus = await prisma.bus.findFirst({
    orderBy: { busNumber: "asc" },
    select: {
      id: true,
      busNumber: true,
      currentLat: true,
      currentLng: true,
      headingDeg: true,
      speedKph: true,
      lastLocationAt: true,
      onboardCount: true,
    },
  });
  if (!bus) {
    console.error("  No buses. Run `npm run db:seed` first.");
    process.exit(2);
  }

  const device = await prisma.busDevice.create({
    data: {
      busId: bus.id,
      label: "Smoke tracker",
      tokenHash: hashDeviceToken(generateDeviceToken().token),
    },
    select: { id: true },
  });

  // A second tracker on the same bus, to prove admission is per device rather
  // than per bus - two units must not throttle each other.
  const second = await prisma.busDevice.create({
    data: {
      busId: bus.id,
      label: "Smoke tracker 2",
      tokenHash: hashDeviceToken(generateDeviceToken().token),
    },
    select: { id: true },
  });

  // Both rows above store a hash of a *discarded* token. Mint the real ones here
  // so the test only ever holds the plaintext it is about to send.
  const { token: tokenA } = generateDeviceToken();
  await prisma.busDevice.update({ where: { id: device.id }, data: { tokenHash: hashDeviceToken(tokenA) } });
  const { token: tokenB } = generateDeviceToken();
  await prisma.busDevice.update({ where: { id: second.id }, data: { tokenHash: hashDeviceToken(tokenB) } });

  console.log(`  bus ${bus.busNumber} · ${PATH}\n`);

  try {
    // --- Authentication --------------------------------------------------------
    const noAuth = await post({ lat: OFF_ROUTE.lat, lng: OFF_ROUTE.lng }, null);
    report(noAuth.status === 401, "refuses a report with no token", `got ${noAuth.status}`);

    const badAuth = await post(
      { lat: OFF_ROUTE.lat, lng: OFF_ROUTE.lng },
      "nvd_definitely_not_a_real_token_value_000000000000000000000000",
    );
    report(badAuth.status === 401, "refuses an unknown token", `got ${badAuth.status}`);

    // --- Validation ------------------------------------------------------------
    const missing = await post({ lat: OFF_ROUTE.lat }, tokenA);
    report(missing.status === 400, "refuses a body missing lng", `got ${missing.status}`);

    const notJson = await post("{not json", tokenA, true);
    report(notJson.status === 400, "refuses a body that is not JSON", `got ${notJson.status}`);

    // --- Acceptance ------------------------------------------------------------
    const accepted = await post({ lat: OFF_ROUTE.lat, lng: OFF_ROUTE.lng }, tokenA);
    const acceptedBody = (await accepted.json()) as {
      ok?: boolean;
      busId?: string;
      persisted?: boolean;
    };
    report(
      accepted.status === 202 && acceptedBody.ok === true,
      "accepts a well-formed report from a valid token",
      `got ${accepted.status}`,
    );
    report(
      acceptedBody.busId === bus.id,
      "reports which bus it is moving",
      acceptedBody.busId ?? "no busId",
    );
    report(acceptedBody.persisted === true, "persists the first report", JSON.stringify(acceptedBody));

    const written = await prisma.bus.findUnique({
      where: { id: bus.id },
      select: { currentLat: true, currentLng: true, lastLocationAt: true },
    });
    report(
      written?.currentLat === OFF_ROUTE.lat && written?.currentLng === OFF_ROUTE.lng,
      "writes the position to the bus row, exactly as a driver's phone does",
      `got ${written?.currentLat},${written?.currentLng}`,
    );
    report(written?.lastLocationAt instanceof Date, "stamps lastLocationAt");

    // --- Cadence ---------------------------------------------------------------
    // Must be sent while the first report is still inside the minimum interval.
    const tooFast = await post({ lat: OFF_ROUTE.lat, lng: OFF_ROUTE.lng }, tokenA);
    report(tooFast.status === 429, "drops a ping that arrives too quickly", `got ${tooFast.status}`);
    report(
      tooFast.headers.get("Retry-After") !== null,
      "tells the tracker how long to wait",
      String(tooFast.headers.get("Retry-After")),
    );

    // --- Freshness -------------------------------------------------------------
    // The gate has to let this one through before the age check can reject it.
    await sleep(2100);
    const stale = await post(
      { lat: OFF_ROUTE.lat, lng: OFF_ROUTE.lng, recordedAt: new Date(Date.now() - 5 * 60_000) },
      tokenA,
    );
    report(stale.status === 409, "rejects a replayed fix instead of re-stamping it", `got ${stale.status}`);

    // --- Per-device admission ---------------------------------------------------
    // A second unit on the same bus has its own clock, so it is not throttled by
    // the first one's report two seconds ago.
    const other = await post({ lat: OFF_ROUTE.lat, lng: OFF_ROUTE.lng }, tokenB);
    report(other.status === 202, "a second tracker on the bus is not throttled by the first", `got ${other.status}`);

    // --- Revocation -------------------------------------------------------------
    await prisma.busDevice.update({
      where: { id: second.id },
      data: { revokedAt: new Date() },
    });
    await sleep(2100);
    const revoked = await post({ lat: OFF_ROUTE.lat, lng: OFF_ROUTE.lng }, tokenB);
    report(revoked.status === 401, "refuses a revoked token", `got ${revoked.status}`);
  } finally {
    // --- Cleanup ----------------------------------------------------------------
    await prisma.busDevice.deleteMany({ where: { id: { in: [device.id, second.id] } } });
    await prisma.bus.update({
      where: { id: bus.id },
      data: {
        currentLat: bus.currentLat,
        currentLng: bus.currentLng,
        headingDeg: bus.headingDeg,
        speedKph: bus.speedKph,
        lastLocationAt: bus.lastLocationAt,
        onboardCount: bus.onboardCount,
      },
    });
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\n  smoke:ingest threw:\n", error);
  await prisma.$disconnect();
  process.exit(1);
});
