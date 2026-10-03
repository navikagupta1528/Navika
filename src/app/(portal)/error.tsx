"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The boundary for a failed page render inside the portal.
 *
 * WHY THIS EXISTS RATHER THAN NEXT'S DEFAULT.
 *
 * Next's built-in error screen is honest but not useful on a bus tracking app: it
 * says "Application error: a client-side exception has occurred" and offers no way
 * back except the browser's back button. For a parent who opened the wrong link
 * mid-run, or a driver whose phone dropped signal, that is a dead end.
 *
 * What this boundary actually offers:
 *
 *  - The error `digest`, shown when there is one. Next deliberately hides server
 *    error details from the browser, which is correct - it means the only way to
 *    match a user report to a server log is the digest, and a user who cannot see
 *    their own digest cannot quote it in a bug report.
 *  - A retry that re-runs the render, rather than a reload. On a flaky mobile
 *    connection this is often enough, and it does not throw away form state the
 *    way a reload does.
 *  - A link home, because "reload" is often not what fixes a bad id or a deleted
 *    record.
 *
 * The message deliberately does not name the error. Server Component errors are
 * forwarded as a generic message for good reason, and echoing `error.message` here
 * would put database and file details back into the page for anyone who opens dev
 * tools - undoing the redaction Next did for us.
 */
export default function PortalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The real destination is the server log, which has the full message. This is
    // a console note so a developer looking at the browser sees something.
    console.error(error);
  }, [error]);

  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Something went wrong
        </p>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">
          This screen could not be loaded
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Nothing has been lost. Trying again usually works - the most common cause is
          a connection that dropped while the page was loading.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => retry()} className="btn-primary">
            Try again
          </button>
          {/*
            `router.push` rather than a hard `location.assign`. Going "home" is an
            ordinary internal navigation and keeps the portal layout mounted, so the
            user does not watch the whole shell re-hydrate. `retry()` above stays
            the right fix for a transient fetch failure; this is the escape hatch
            for a URL that will fail the same way every time - a deleted record id,
            say, which would otherwise loop on retry.
          */}
          <button type="button" onClick={() => router.push("/")} className="btn-secondary">
            Go to my dashboard
          </button>
        </div>

        {error.digest ? (
          <p className="mt-5 border-t border-slate-200 pt-3 text-xs text-slate-500">
            If you report this, quote{" "}
            <code className="code-inline">
              {error.digest}
            </code>
            . It matches the entry in the server log for this failure.
          </p>
        ) : null}
      </div>
    </div>
  );
}