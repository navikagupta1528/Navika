import Link from "next/link";

import { IconBadge } from "@/components/ui/primitives";

/**
 * 404 inside the portal.
 *
 * DISTINCT FROM A FAILED RENDER ON PURPOSE.
 *
 * `notFound()` is called by admin detail pages when an id does not resolve, which
 * is a normal thing for a bookmarked or shared link to do. That is not an error
 * and must not be dressed up as one: showing "something went wrong, try again"
 * for a deleted record invites the user to retry something that will never
 * succeed. The message here says the page does not exist, which is the truth.
 *
 * Deliberately no layout chrome is imported. This boundary renders inside the
 * existing portal layout, so it inherits the nav, and re-importing the shell
 * would nest a second one inside the first.
 */
export default function PortalNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="busguard-rise w-full max-w-md text-center">
        <div className="mb-4 flex justify-center">
          {/*
            A map glyph rather than an error glyph. A 404 is not a failure - the
            link simply leads nowhere - and reusing the error boundary's red
            triangle would say "something broke" about a route that behaved
            exactly as it should. It is decorative; the heading carries it.
          */}
          <IconBadge name="map" tone="slate" size="lg" />
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Not found
        </p>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">
          That page does not exist
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          The link may be out of date, or the record it pointed at may have been
          removed. If you followed a link from an email or a notification, the
          record behind it was probably deleted.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/" className="btn-primary">
            Go to my dashboard
          </Link>
          <Link href="/notifications" className="btn-secondary">
            Check notifications
          </Link>
        </div>
      </div>
    </div>
  );
}