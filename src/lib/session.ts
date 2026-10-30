import "server-only";
import { cookies } from "next/headers";
import {
  decryptSession,
  encryptSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type SessionPayload,
} from "@/server/session-core";

export type { SessionPayload };
export { SESSION_COOKIE };

export async function createSession(payload: SessionPayload & { mustChangePassword?: boolean }, rememberMe = false): Promise<void> {
  const token = await encryptSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: rememberMe ? 60 * 60 * 24 * 30 : SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decryptSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
