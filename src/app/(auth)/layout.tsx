import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-50">
      {/*
        Two blurred blobs drifting behind the card. `aria-hidden` because a
        decorative gradient is not content, and a screen reader announcing
        "graphic" on every sign-in is noise.

        Fixed pixel sizes rather than viewport units on purpose: a `vw` blob
        would re-rasterise its 70px blur on every resize, and this sits behind
        the fold on a phone where it is not even visible.
      */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="navika-ambient navika-ambient--a navika-ambient-a" />
        <div className="navika-ambient navika-ambient--b navika-ambient-b" />
      </div>

      <div className="relative flex min-h-screen flex-col">
        <header className="px-6 py-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg transition-opacity hover:opacity-80"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white shadow-sm">
              N
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-900">
              Navika
            </span>
          </Link>
        </header>

        <main
          id="main"
          className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center"
        >
          <div className="navika-stagger w-full max-w-md">
            {/*
              `navika-stagger` walks direct children in. The card rises, then
              the footnote. Transform-only, so Largest Contentful Paint is
              recorded on the first frame regardless of the animation.
            */}
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-lg shadow-slate-900/5 backdrop-blur-sm sm:p-8">
              {children}
            </div>
            {/*
              `text-slate-600`, not `text-slate-500`, and this is not a
              preference. This line sits directly on the drifting ambient
              gradient, so its background is whatever the blob happens to be
              passing over at that instant. `slate-500` measures 4.55:1 against
              plain `slate-50` and 3.8:1 where the blob is behind it - under the
              4.5:1 floor, so it fails the audit whenever the animation happens
              to be mid-sweep. `slate-600` holds 6.05:1 at the worst point in
              the cycle, which is a margin rather than a pass.

              This is the failure mode decorative backgrounds create: text that
              was verified once against a flat colour and then silently made
              conditional on animation timing.
            */}
            <p
              className="mt-6 text-center text-xs leading-relaxed text-slate-600"
              style={{ "--navika-i": 1 } as React.CSSProperties}
            >
              Live bus location, arrival estimates and pickup tracking for college
              and school transport.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}