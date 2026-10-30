/**
 * Device tokens for the hardware ingestion path.
 *
 * A phone in a driver's pocket is not the only way a bus can report its
 * position, and in a real fleet it is often not the way at all: a school fits a
 * tracker to the vehicle. That tracker has no login, no session cookie and no
 * browser, so it authenticates with a bearer token instead.
 *
 * Tokens are minted once and stored only as a SHA-256 hash. That is the right
 * choice here, and distinct from the one made for passwords, for two reasons:
 *
 *   - Entropy. A login password is short and guessable, so it needs a slow hash
 *     to make an offline guess expensive. This token is 32 random bytes; there
 *     is nothing to guess, so a slow hash buys nothing.
 *   - Cost on the hot path. The device posts a position every few seconds. A
 *     bcrypt comparison per request would cost milliseconds on the busiest route
 *     in the product. A SHA-256 hex compare is microseconds.
 *
 * Nothing here is `server-only` and nothing here is fake-pure: it touches
 * `node:crypto` and nothing else, so the unit test can exercise it directly.
 */
import { createHash, randomBytes } from "node:crypto";

/** Marks a token as ours at a glance in a log or a config panel. */
export const DEVICE_TOKEN_PREFIX = "nvd_";

/** 32 random bytes -> 43 base64url characters. */
const TOKEN_BYTES = 32;

/**
 * Mint a new device token.
 *
 * Returns both the plaintext - shown to the admin exactly once and never stored
 * - and the hash that is what actually goes in the database.
 */
export function generateDeviceToken(): { token: string; hash: string } {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, hash: hashDeviceToken(token) };
}

/** The stored form of a token. Hex, so it indexes and compares as text. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A cheap shape check, used to answer obvious garbage without a database round
 * trip. Not a security check: the lookup by hash is the real one.
 */
export function looksLikeDeviceToken(value: string): boolean {
  if (!value.startsWith(DEVICE_TOKEN_PREFIX)) return false;
  // base64url of 32 bytes is 43 characters. Require most of that so a one-byte
  // body cannot reach the database, but leave room for a future token length.
  return value.length >= DEVICE_TOKEN_PREFIX.length + 32;
}

/**
 * The token from an `Authorization: Bearer <token>` header, or null.
 *
 * The scheme is matched case-insensitively because RFC 7235 says the scheme is
 * case-insensitive, and some HTTP clients send `bearer`.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
