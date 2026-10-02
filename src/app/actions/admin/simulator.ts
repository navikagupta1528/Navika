"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/admin/guard";
import { isSimulating, startSimulation, stopSimulation } from "@/server/simulator-runner";

export type SimulationResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Start or stop a simulated bus.
 *
 * The movement maths lives in `@/lib/simulator` and the interval in
 * `@/server/simulator-runner`; this is only the admin-facing entry point, kept
 * thin so the write path stays easy to audit.
 *
 * `assertAdmin` throws rather than returning a value, which is why there is no
 * error branch here for it - an unauthorised caller never gets as far as the
 * result object.
 */
export async function toggleSimulation(
  _prev: SimulationResult | null,
  formData: FormData,
): Promise<SimulationResult> {
  await assertAdmin();

  const busId = String(formData.get("busId") ?? "").trim();
  if (!busId) {
    return { ok: false, error: "That request was missing a bus." };
  }

  /*
   * Stopping changes what the server renders - the "simulated" badge and the
   * button's own label both come from the database - so it revalidates. Starting
   * does not strictly need to: the fleet screen gets positions from the socket on
   * a 1 Hz tick, and the badge appears from the revalidated render. Revalidating
   * both keeps the two paths symmetrical and the cost is one render.
   */
  const wasRunning = isSimulating(busId);

  if (wasRunning) {
    await stopSimulation(busId);
    revalidatePath("/admin/buses");
    revalidatePath(`/admin/buses/${busId}`);
    revalidatePath("/fleet");
    return { ok: true, message: "Simulation stopped." };
  }

  const result = await startSimulation(busId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/buses");
  revalidatePath(`/admin/buses/${busId}`);
  revalidatePath("/fleet");

  return {
    ok: true,
    message: result.alreadyRunning
      ? "That bus was already being simulated."
      : "Driving its route now. Open the fleet map to watch it move.",
  };
}