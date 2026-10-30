"use client";

import { createClient } from "@supabase/supabase-js";

let supabase: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (supabase) return supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  supabase = createClient(url, key, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  return supabase;
}

export function getBusChannel(busId: string) {
  return getSupabaseClient().channel(`bus:${busId}`, {
    config: {
      broadcast: { self: true, ack: false },
    },
  });
}

export function getFleetChannel() {
  return getSupabaseClient().channel("fleet", {
    config: {
      broadcast: { self: false, ack: false },
    },
  });
}

export function getUserChannel(userId: string) {
  return getSupabaseClient().channel(`user:${userId}`, {
    config: {
      broadcast: { self: false, ack: false },
    },
  });
}

export function getDriverChannel(busId: string) {
  return getSupabaseClient().channel(`driver:${busId}`, {
    config: {
      broadcast: { self: false, ack: false },
    },
  });
}
