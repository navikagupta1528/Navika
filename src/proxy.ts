import { NextResponse, type NextRequest } from "next/server";
import { decryptSession, SESSION_COOKIE } from "@/server/session-core";

/**
 * Optimistic redirect layer only.
 *
 * This runs on every matched request, so it must stay cheap: it verifies the
 * signed cookie and nothing else. Real authorization happens in the DAL
 * (src/lib/dal.ts) next to each query, because a redirect here alone does not
 * protect the underlying data.
 */
const PROTECTED_PREFIXES = ["/admin", "/driver", "/student", "/parent"];
const AUTH_ROUTES = ["/login", "/register"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (!isProtected && !isAuthRoute) {
    return NextResponse.next();
  }

  // Read straight off the request to avoid a second cookies() round trip.
  const session = await decryptSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (isProtected && !session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && session) {
    const home =
      session.role === "ADMIN"
        ? "/admin"
        : session.role === "DRIVER"
          ? "/driver"
          : session.role === "PARENT"
            ? "/parent"
            : "/student";
    return NextResponse.redirect(new URL(home, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except API routes, Next internals, and common static assets.
     * Server Actions post to the page they are used on, so protected pages
     * must stay inside the matcher.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
