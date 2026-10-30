/**
 * Session cryptography, with no framework dependencies.
 *
 * This file is loaded by three different runtimes:
 *   1. Next.js server components and server actions (via src/lib/session.ts)
 *   2. The custom Node server, for the Socket.IO handshake
 *   3. Nothing in the browser — the token is httpOnly
 *
 * So it deliberately does NOT import `server-only` or anything from `next/*`.
 * Keeping one implementation means the cookie the browser holds is verified by
 * exactly the same code that minted it.
 */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "busguard_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // one working day

export type SessionRole = "STUDENT" | "PARENT" | "DRIVER" | "ADMIN";

export type SessionPayload = {
  userId: string;
  role: SessionRole;
};

function getKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getKey());
}

export async function decryptSession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.role !== "string") return null;
    return {
      userId: payload.sub,
      role: payload.role as SessionRole,
    };
  } catch {
    return null;
  }
}

/** Pull one cookie out of a raw `Cookie` header. Used by the Socket.IO handshake. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
