/**
 * POST /api/ingest/location - a hardware tracker reporting a bus position.
 *
 * WHY THIS EXISTS
 *
 * Until now the only thing that could move a bus was a driver's browser. That is
 * fine for a demo and wrong for a school: the normal installation is a tracker
 * bolted to the vehicle, reporting whether or not anybody's phone is awake. The
 * ingestion shapes - `locationPingSchema` and the ping cadence - were written
 * during an earlier pass and never wired to anything. This is the missing half.
 *
 * It deliberately reuses `applyPosition`, the identical pipeline the driver's
 * Socket.IO ping goes through, so a tracker and a phone cannot disagree about
 * how a fix is validated, broadcast or recorded.
 *
 * Authentication is a bearer token, not a cookie; see `@/server/device-auth`.
 * The proxy matcher excludes `/api`, so this handler is its own front door and
 * checks the token itself.
 */
import { authenticateDevice, touchDevice } from "@/server/device-auth";
import { applyPosition } from "@/server/position-pipeline";
import { createIngestGate } from "@/lib/device-ingest";
import { locationPingSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

/**
 * One gate for the process.
 *
 * In-memory by design: it bounds how often one device can make watchers' maps
 * redraw, and a second instance keeping its own copy is a bounded cost, not a
 * correctness problem. See `createIngestGate` for the reasoning.
 */
const gate = createIngestGate();

function problem(status: number, message: string, headers?: Record<string, string>): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const device = await authenticateDevice(request.headers.get("authorization"));
  if (!device) return problem(401, "Missing or invalid device token.");

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return problem(400, "Request body must be JSON.");
  }

  const parsed = locationPingSchema.safeParse(body);
  if (!parsed.success) {
    return problem(400, "lat and lng are required, and must be in range.");
  }

  const admission = gate.admit(device.deviceId, Date.now());
  if (!admission.accept) {
    return problem(429, "Pings are arriving too quickly.", {
      "Retry-After": String(Math.max(1, Math.ceil(admission.retryAfterMs / 1000))),
    });
  }

  const { lat, lng, speedKph, headingDeg, recordedAt } = parsed.data;

  const outcome = await applyPosition({
    busId: device.busId,
    lat,
    lng,
    speedKph: speedKph ?? null,
    headingDeg: headingDeg ?? null,
    // The device's own clock, when it sends one. The pipeline drops a replayed
    // fix rather than re-stamping it with the server's time.
    reportedAt: recordedAt ? recordedAt.getTime() : null,
    persist: admission.persist,
  });

  if (!outcome.accepted) {
    return problem(409, `Fix rejected: ${outcome.reason}.`);
  }

  void touchDevice(device.deviceId);

  return Response.json(
    { ok: true, busId: device.busId, persisted: admission.persist },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
