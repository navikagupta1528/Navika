import { NextResponse, type NextRequest } from "next/server";
import { decryptSession, SESSION_COOKIE } from "@/server/session-core";

/**
 * Optimistic redirect layer only.
 *
 * This runs on every matched request, so it must stay cheap: it verifies the
 * signed cookie and compares a role string, and touches neither the database
 * nor the network.
 *
 * It is an OPTIMISTIC layer, not the authorization. Real enforcement stays in
 * the DAL (`requireRole` in src/lib/dal.ts) next to each query, because a
 * redirect on its own does not protect the data - a page that forgot to call
 * `requireRole` would still be reachable if this were the only check. Removing
 * the proxy would not make a single query less safe.
 *
 * What the proxy genuinely adds is the redirect being a real HTTP 307 with an
 * empty body. A `redirect()` thrown from inside a page render happens *after*
 * React has begun streaming, so by the time it throws the browser has already
 * been sent a 200 with part of the layout, and the redirect has to travel back
 * as a `<meta http-equiv="refresh">` tag in the middle of that HTML. A driver
 * who types an admin URL into the address bar sees a flash of the app shell and
 * a second of the wrong page before landing on their own dashboard. Deciding it
 * here, before a single byte of React is rendered, is what makes it a redirect
 * rather than a flicker.
 */
const ALL_ROLES = ["ADMIN", "DRIVER", "PARENT", "STUDENT"];

/**
 * Which roles each area belongs to.
 *
 * `roles` is a list rather than a single role because `/track` and `/fleet` are
 * legitimately reachable by students, parents and admins alike - the per-bus
 * enrolment check on the page itself is what narrows a watcher to the right bus.
 * Writing this as one role per area would have quietly made the tracking page
 * unreachable for two thirds of its audience.
 *
 * Every area still requires a session. The list only decides who may be in.
 *
 * A prefix that is absent from this table is a prefix that skips the check
 * entirely, which is the failure mode worth naming: `/track`, `/fleet`,
 * `/notifications` and `/install` were all missing when this list was first
 * written, and every one of them still enforced the rule in its own `requireRole`.
 * Nothing leaked. But that check runs *after* React has started streaming, so
 * the response was a 200 carrying the app shell, with the redirect arriving a
 * second later as a `<meta http-equiv="refresh">` tag - an anonymous visitor got
 * to see the inside of the app before being sent away. Any page added to the
 * portal belongs in this table; the proxy, not the page, is what answers first.
 */
const PROTECTED_AREAS: { prefix: string; roles: string[] }[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/driver", roles: ["DRIVER"] },
  { prefix: "/student", roles: ["STUDENT"] },
  { prefix: "/parent", roles: ["PARENT"] },
  { prefix: "/fleet", roles: ["ADMIN", "PARENT", "STUDENT"] },
  { prefix: "/track", roles: ["ADMIN", "PARENT", "STUDENT"] },

  // Shared pages. The driver PWA install instructions, and the one inbox every
  // role reads.
  { prefix: "/notifications", roles: ALL_ROLES },
  { prefix: "/install", roles: ALL_ROLES },
];
const AUTH_ROUTES = ["/login", "/register"];

/**
 * The public landing page at `/`.
 *
 * It used to be a redirect: the root route read the session and bounced you to
 * `/login` or to your dashboard, which meant the very first thing anyone saw
 * was a login form. There was no page that said what BusGuard is.
 *
 * The decision now lives *here* rather than in `src/app/page.tsx`, for one
 * concrete reason: a page that reads the cookie to decide what to render is a
 * dynamic route, so the landing page could never be prerendered. Moving the
 * branch into the proxy lets `page.tsx` be a plain server component that the
 * build can emit as static HTML, while the signed-in visitor still gets bounced
 * to their dashboard the instant they hit `/` - before a byte of React is
 * rendered, so there is no flash of a marketing page on the way to a dashboard.
 *
 * This is the only route in the app where the proxy decides *what* is rendered
 * rather than merely who may enter.
 */
const PUBLIC_LANDING = "/";

function homeFor(role: string): string {
  return role === "ADMIN"
    ? "/admin"
    : role === "DRIVER"
      ? "/driver"
      : role === "PARENT"
        ? "/parent"
        : "/student";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Longest prefix wins.
   *
   * Without the sort, an area whose name is a prefix of another's would match
   * both - and whichever happened to be listed first would decide. No current
   * area name is a prefix of another, so this is not fixing an active bug; it is
   * making that true by construction rather than by coincidence, because the
   * next area someone adds might well be `/admin/reports` or `/parent/child`.
   *
   * The trailing slash in `startsWith` is load-bearing and is why the equality
   * test is needed alongside it: without it, `/administer` would match `/admin`.
   */
  const area = [...PROTECTED_AREAS]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find(
      ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const isLanding = pathname === PUBLIC_LANDING;

  if (!area && !isAuthRoute && !isLanding) {
    return NextResponse.next();
  }

  // Read straight off the request to avoid a second cookies() round trip.
  const session = await decryptSession(request.cookies.get(SESSION_COOKIE)?.value);

  /*
   * A signed-in visitor landing on `/` gets their dashboard, and an anonymous
   * one gets the landing page itself.
   *
   * This runs before any other check on this route, because `/` matches no
   * area: without this branch the marketing page would render for everyone,
   * including a driver who had simply typed the domain into their phone.
   */
  if (isLanding) {
    return session
      ? NextResponse.redirect(new URL(homeFor(session.role), request.url))
      : NextResponse.next();
  }

  if (area && !session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  /*
   * Signed in, but in the wrong place.
   *
   * Compared against the JWT's own role claim, which is signed, so it cannot be
   * forged by the client. Note this trusts the token and not the database: a
   * role changed in the database does not take effect until the cookie is
   * reissued. That is a deliberate trade - it keeps this layer free of a query
   * on every matched request - and it is safe because the DAL re-reads the
   * session on each render and the stale window is the cookie's own lifetime.
   */
  if (area && session && !area.roles.includes(session.role)) {
    return NextResponse.redirect(new URL(homeFor(session.role), request.url));
  }

  if (isAuthRoute && session) {
    return NextResponse.redirect(new URL(homeFor(session.role), request.url));
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
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
