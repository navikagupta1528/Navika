import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let serverClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseServer() {
  if (serverClient) return serverClient;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  serverClient = createClient(supabaseUrl, supabaseKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  return serverClient;
}

export async function broadcastToBus(busId: string, event: string, payload: unknown) {
  const supabase = getSupabaseServer();
  await supabase.channel(`bus:${busId}`).send({
    type: "broadcast",
    event,
    payload,
  });
}

export async function broadcastToFleet(event: string, payload: unknown) {
  const supabase = getSupabaseServer();
  await supabase.channel("fleet").send({
    type: "broadcast",
    event,
    payload,
  });
}

export async function broadcastToUser(userId: string, event: string, payload: unknown) {
  const supabase = getSupabaseServer();
  await supabase.channel(`user:${userId}`).send({
    type: "broadcast",
    event,
    payload,
  });
}

export async function broadcastToDriver(busId: string, event: string, payload: unknown) {
  const supabase = getSupabaseServer();
  await supabase.channel(`driver:${busId}`).send({
    type: "broadcast",
    event,
    payload,
  });
}
