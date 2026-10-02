/**
 * Layout for the signed-in area.
 *
 * It renders no markup of its own. Its job is to declare, once, that everything
 * below the login page is per-request.
 */

/*
 * WHY THIS FILE EXISTS AT ALL.
 *
 * Because of `loading.tsx` sitting next to it.
 *
 * Adding a `loading.tsx` wraps the whole group in a Suspense boundary, and that
 * is enough to change how the build treats these routes: with a boundary present,
 * `next build` attempts to prerender `/admin` at build time. Every page in the
 * portal calls `requireRole`, which reads the session cookie, and marks the route
 * dynamic — but that only happens once rendering starts. The prerender begins,
 * the page's `Promise.all` of Prisma counts starts executing, and the build fails
 * on `Can't reach database server` before the cookie is ever read.
 *
 * The symptom is misleading: the error points at `prisma.bus.count()` and reads
 * like a broken database connection, when the real cause is a Suspense boundary
 * added three files away. Without `loading.tsx` the same tree builds clean, which
 * is what makes this worth writing down.
 *
 * Declaring `force-dynamic` here is the honest description of this part of the
 * app anyway: every page behind the login renders differently per signed-in user,
 * so none of it is cacheable as a static artifact. Saying it in one place is
 * better than relying on each page to discover it during its own render.
 *
 * This is the documented pre-Cache-Components behaviour. If `cacheComponents` is
 * ever enabled in `next.config.ts`, `dynamic` is removed along with `revalidate`
 * and `fetchCache`, and this declaration has to become per-page `"use cache"`
 * boundaries instead - at which point the interesting question becomes which
 * authenticated content can safely be shared between users, which is most of
 * none of it.
 *
 * Valid because Cache Components is not enabled in `next.config.ts`. With it on,
 * Next ignores this export.
 */
export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: LayoutProps<"/">) {
  return children;
}