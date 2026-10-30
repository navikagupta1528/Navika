import Link from "next/link";

import { BrandMark } from "@/components/ui/brand-mark";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * The three things a person sees before they ever see a bus.
 *
 * On a wide screen this is a two-column layout: a brand panel on the left that
 * says what the product is, and the form on the right. On a phone it collapses
 * to the form alone with the panel dropped, because a driver standing at a bus
 * stop does not need the pitch - they need the sign-in box, and the panel would
 * push it below the fold.
 *
 * THE CONTRAST PROBLEM THIS SOLVES
 * --------------------------------
 * The first version of this screen put everything on a drifting ambient
 * gradient. That meant the footnote measured 6:1 against flat slate-50 and
 * 3.8:1 wherever a blob happened to be behind it - a pass or a fail depending
 * on where an animation loop was when the checker ran. The fix is structural
 * rather than a colour tweak: the brand panel now uses a *solid* dark green, so
 * anything placed on it is white-on-dark and the number is high and stable
 * instead of conditional on timing. The ambient blobs survive only on the
 * mobile view, where they sit behind a white card rather than behind text.
 */
const POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "locate",
    title: "Live location",
    body: "Every bus reports its position while a trip is running.",
  },
  {
    icon: "clock",
    title: "Arrival estimates",
    body: "A countdown to your stop that updates as the bus moves.",
  },
  {
    icon: "bell",
    title: "Pickup alerts",
    body: "Parents are told when a bus is approaching, and when a student boards.",
  },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative min-h-screen bg-slate-50">
      {/*
        The drifting blobs are for the phone view only. On desktop they would sit
        behind the brand panel's solid colour, where they are invisible anyway,
        so keeping them mobile-only means one less continuous animation on the
        most expensive screen. `aria-hidden` because a decorative gradient is not
        content.

        Fixed pixel sizes rather than viewport units on purpose: a `vw` blob
        would re-rasterise its 70px blur on every resize, and this sits behind
        the fold on a phone where it is not even visible.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden"
      >
        <div className="busguard-ambient busguard-ambient--a busguard-ambient-a" />
        <div className="busguard-ambient busguard-ambient--b busguard-ambient-b" />
      </div>

      <div className="relative min-h-screen lg:grid lg:grid-cols-2">
        {/* ---------------- The brand panel ---------------- */}
        {/*
          `aria-label` on the `<aside>` rather than a heading inside it. The
          headline below is deliberately an `<h2>`-free `<p>`: this panel renders
          *before* the form in the DOM, and a heading here would come before the
          page's own `<h1>` and break the outline. It is a complementary landmark
          so a screen reader can jump past it, and everything in it is
          informational rather than interactive.
        */}
        <aside
          aria-label="About BusGuard"
          className="relative hidden overflow-hidden bg-brand-800 lg:flex lg:flex-col lg:justify-between lg:p-12"
        >
          {/* A faint grid and a pair of soft glows give the flat green some
              depth. Both are static, so nothing here animates. */}
          <div
            aria-hidden
            className="busguard-grid pointer-events-none absolute inset-0 opacity-60"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl"
          />

          <div className="relative">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <BrandMark size={40} />
              <span className="text-lg font-semibold tracking-tight text-white">
                BusGuard
              </span>
            </Link>

            <p className="mt-10 max-w-md text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
              Know where the bus is. Know your child is on it.
            </p>
            <p className="mt-4 max-w-md text-base leading-relaxed text-brand-100">
              Live tracking, arrival estimates and pickup records for college and
              school transport - for drivers, students, parents and the transport
              office.
            </p>
          </div>

          <ul className="relative mt-10 space-y-4">
            {POINTS.map((point) => (
              <li key={point.title} className="flex items-start gap-3">
                {/* A white tile on dark green. The icon is decorative, so the
                    contrast that matters is the text beside it, which is
                    white-on-brand-800 and comfortably past the AA floor. */}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
                  <Icon name={point.icon} className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {point.title}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-brand-100">
                    {point.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <p className="relative text-xs text-brand-200">
            A demonstration system. Everything you see is backed by real data.
          </p>
        </aside>

        {/* ---------------- The form ---------------- */}
        <div className="flex min-h-screen flex-col">
          {/*
            A compact brand row on every view. On desktop the logo already lives
            in the panel, so this one shows only on smaller screens to avoid
            saying the same thing twice.
          */}
          <header className="px-6 py-5 lg:hidden">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg transition-opacity hover:opacity-80"
            >
              <BrandMark size={32} />
              <span className="text-base font-semibold tracking-tight text-slate-900">
                BusGuard
              </span>
            </Link>
          </header>

          <main
            id="main"
            className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center"
          >
            <div className="busguard-stagger w-full max-w-md">
              {/*
                `busguard-stagger` walks direct children in. The card rises, then
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
                style={{ "--busguard-i": 1 } as React.CSSProperties}
              >
                Live bus location, arrival estimates and pickup tracking - so a
                parent knows the bus is close, and that their child is on it.
              </p>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
