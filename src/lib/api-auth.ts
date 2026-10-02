import "server-only";

import { readSession, type SessionPayload } from "@/lib/session";
import { Role } from "@/generated/prisma/enums";

/**
 * Authorization for route handlers, which cannot use `requireRole`.
 *
 * `requireRole` calls `redirect()`, which is the right answer for a page and the
 * wrong answer for a file download: the browser would follow the redirect to an
 * HTML login page and then try to save *that* as "attendance.csv". A handler that
 * returns a file has to answer in status codes, so it gets its own guard.
 *
 * This matters more than usual here because the proxy does not help. Its matcher
 * excludes `/api`, so nothing redirects an unauthenticated caller away from an
 * export route - every handler is its own front door and has to check.
 */

export type ApiGuard = { ok: true; session: SessionPayload } | { ok: false; response: Response };

function problem(status: number, message: string): ApiGuard {
  return {
    ok: false,
    response: Response.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    ),
  };
}

/**
 * 401 when there is no session, 403 when the session is the wrong role.
 *
 * Deliberately does not say *which* roles are allowed. An export route that
 * answered "admins only" to an anonymous caller confirms the feature exists to
 * anyone who guesses the path.
 */
export async function requireApiRole(...roles: Role[]): Promise<ApiGuard> {
  const session = await readSession();
  if (!session) return problem(401, "Sign in to continue.");
  if (!roles.includes(session.role)) return problem(403, "Not allowed.");
  return { ok: true, session };
}
