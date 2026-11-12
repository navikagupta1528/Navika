import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type ServerClient = ReturnType<typeof createClient>;

let serverClient: ServerClient | null = null;

/**
 * The broadcast client, or `null` when this deployment does not do Supabase
 * realtime.
 *
 * It used to throw instead. Every caller fires a broadcast with `void` after a
 * database write has already succeeded, so a throw here does not protect
 * anything - it turns "realtime is not configured" into a 500 on a page whose
 * data was saved correctly. The attendance smoke test hit exactly that: the
 * check-in was written, then the page crashed while telling a channel nobody
 * was listening on.
 *
 * Push already degrades this way (`src/lib/push.ts` treats missing keys as "this
 * deployment does not do push"). This is the same contract for the same reason:
 * a blank optional secret is a supported configuration, not a misconfiguration.
 */
export function getSupabaseServer(): ServerClient | null {
  if (serverClient) return serverClient;
  if (!supabaseUrl || !supabaseKey) return null;
  serverClient = createClient(supabaseUrl, supabaseKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  return serverClient;
}

async function send(channel: string, event: string, payload: unknown) {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  await supabase.channel(channel).send({ type: "broadcast", event, payload });
}

export async function broadcastToBus(busId: string, event: string, payload: unknown) {
  await send(`bus:${busId}`, event, payload);
}

export async function broadcastToFleet(event: string, payload: unknown) {
  await send("fleet", event, payload);
}

export async function broadcastToUser(userId: string, event: string, payload: unknown) {
  await send(`user:${userId}`, event, payload);
}
