import Link from "next/link";

import { Badge, IconBadge, Meter, staggerIndex } from "@/components/ui/primitives";
import { BrandMark } from "@/components/ui/brand-mark";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * The public landing page.
 *
 * WHY IT IS SHAPED THIS WAY
 * -------------------------
 * Every other page in this app is a tool for someone who already has an
 * account. This one has to answer a question no tool page does - "what is
 * this?", in about five seconds - for a stranger who arrived from a link, and
 * then get out of the way.
 *
 * It is a Server Component with no interactivity at all. The only motion is the
 * CSS that already exists in globals.css: transform-only entrances, a slow float
 * on the product visual, and the ambient drift. There is nothing to hydrate
 * except the icons, so the page ships almost no JavaScript and its Largest
 * Contentful Paint is the headline on first paint, exactly as the rest of the
 * app is built.
 *
 * The product visual (`ProductPreview`) is a drawing, not a live map - opening a
 * real tile layer here would put a third-party script and its own layout shift
 * in front of the one page whose whole job is to appear instantly. It is marked
 * `aria-hidden`: it is an illustration of a screen, and a screen reader reading
 * a fake "4 min" as if it were live data would be worse than not reading it.
 */

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "locate",
    title: "Live bus location",
    body: "Positions update while a trip is running, with a freshness window so a bus that has gone quiet is never shown as if it were still moving.",
  },
  {
    icon: "clock",
    title: "Arrival countdown",
    body: "A live estimate to your stop that recalculates as the bus moves, not a number frozen at page load.",
  },
  {
    icon: "bell",
    title: "Approach and arrival alerts",
    body: "Parents are told when a bus is roughly 800 m away and again when it is nearly at the stop, so nobody waits outside in the rain.",
  },
  {
    icon: "clipboard",
    title: "Pickup checklist",
    body: "Drivers see who is waiting at each stop and mark students aboard, giving the office a record of who travelled.",
  },
  {
    icon: "radio",
    title: "One fleet map",
    body: "Every reporting bus on a single screen, for the office and for anyone allowed to watch.",
  },
  {
    icon: "reports",
    title: "Attendance and export",
    body: "Trip history, boarding records and CSV exports, so the paper register and the spreadsheet finally agree.",
  },
];

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "install",
    title: "Add it to the home screen",
    body: "BusGuard installs from the browser in a few taps. A driver keeps reporting position with the screen off.",
  },
  {
    icon: "navigate",
    title: "The driver starts the run",
    body: "The driver shares their location once, and the bus appears on the map for everyone watching it.",
  },
  {
    icon: "users",
    title: "Everyone follows along",
    body: "Students see their bus, parents get approach alerts, and the office sees the whole fleet at once.",
  },
];

const ROLES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "graduation",
    title: "Students",
    body: "See your bus, your stop and a live countdown, and tell the driver you are waiting.",
  },
  {
    icon: "users",
    title: "Parents",
    body: "Follow your child's bus and be told when it is approaching, without refreshing anything.",
  },
  {
    icon: "idCard",
    title: "Drivers",
    body: "One screen with today's route, the students waiting at each stop, and a checklist to mark them aboard.",
  },
  {
    icon: "overview",
    title: "Transport office",
    body: "Buses, routes, stops, drivers and trips, with the live fleet and an alert inbox in the same place.",
  },
];

export function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      {/*
        `flex-1` on `main`, together with the column wrapper, pins the footer to
        the bottom of the viewport on a short page. Without it the footer would
        sit directly under the last section with a band of empty white below it,
        because `min-h-screen` on the wrapper only sets a floor, it does not
        distribute the leftover space.
      */}
      <main id="main" className="flex-1">
        <Hero />
        <ValueStrip />
        <Features />
        <Steps />
        <Roles />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark size={36} />
          <span className="text-base font-semibold tracking-tight text-slate-900">
            BusGuard
          </span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="#features"
            className="busguard-underline hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 sm:inline-block"
          >
            Features
          </Link>
          <Link
            href="#how"
            className="busguard-underline hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 sm:inline-block"
          >
            How it works
          </Link>
          <Link href="/login" className="btn-ghost text-sm">
            Sign in
          </Link>
          <Link href="/register" className="btn-primary text-sm">
            Create account
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Decorative backdrop: a faint grid that fades out, and one soft glow.
          Both static, both `aria-hidden`. `isolate` keeps their stacking inside
          this section so they can never sit over the header or the CTA below. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="busguard-grid busguard-mask-b absolute inset-0" />
        <div className="absolute left-1/2 top-[-14rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-brand-200/45 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
        <div className="busguard-stagger">
          <div style={staggerIndex(0)}>
            <Badge tone="brand" dot>
              Student-aware bus tracking for schools and colleges
            </Badge>
          </div>
          {/* The h1 is the Largest Contentful Paint element. `busguard-rise` only
              translates it, so the paint still lands on the first frame. */}
          <h1
            className="busguard-rise mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl"
            style={staggerIndex(1)}
          >
            Know where the bus is.
            <br className="hidden sm:block" />{" "}
            <span className="text-brand-700">Know your child is on it.</span>
          </h1>
          <p
            className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg"
            style={staggerIndex(2)}
          >
            BusGuard tracks people, not dots. Which student is on which bus, which
            stop they board at, whether they have left the house yet - and a live
            countdown to your stop, with an alert the moment the bus is close.
          </p>
          <div
            className="mt-8 flex flex-wrap items-center gap-3"
            style={staggerIndex(3)}
          >
            <Link href="/register" className="btn-primary px-5 py-2.5 text-sm">
              Create your account
              <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn-secondary px-5 py-2.5 text-sm">
              Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500" style={staggerIndex(4)}>
            One form for driver, student and parent accounts. The transport office
            sets the routes and enrols everyone.
          </p>
        </div>

        <div className="relative lg:justify-self-end">
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}

/**
 * The illustration of the product.
 *
 * Entirely decorative and `aria-hidden`, so none of the fake numbers inside it
 * reach assistive technology. Built from the same primitives the real screens
 * use - `Badge`, `Meter`, the icon set - so it cannot drift away from what the
 * app actually looks like.
 *
 * The route now shows what has already happened, not just where the bus is: two
 * served stops sit behind it with a tick, the stop being approached is ringed,
 * and the strip at the bottom is the sentence a parent actually opened the app
 * for. A live dot only proves the bus exists; "Aarav is on board" proves the
 * child does.
 */
function ProductPreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-6 rounded-[2rem] bg-brand-500/10 blur-2xl" />

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark size={36} />
            <div>
              <p className="text-sm font-semibold text-slate-900">Bus KA-01</p>
              <p className="text-[11px] text-slate-500">
                Route R1 · morning run
              </p>
            </div>
          </div>
          <Badge tone="emerald" dot>
            live
          </Badge>
        </div>

        <div className="busguard-dots relative h-44 bg-slate-50">
          <svg
            viewBox="0 0 400 176"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            <path
              d="M 36 146 C 120 146, 116 74, 196 66 S 304 44, 364 40"
              fill="none"
              stroke="var(--color-brand-400)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="0.5 9"
            />
          </svg>

          {/* The two stops already served, behind the bus. A tick on the route
              is the cheapest way to show that a run has a history, not just a
              current position. */}
          <span className="absolute left-[9%] top-[78%] flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700 ring-1 ring-brand-200">
            <Icon name="check" className="h-2.5 w-2.5" />
          </span>
          <span className="absolute left-[47%] top-[36%] flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700 ring-1 ring-brand-200">
            <Icon name="check" className="h-2.5 w-2.5" />
          </span>

          {/* The stop being approached, ringed to separate it from the served
              ones at a glance. */}
          <span className="absolute right-8 top-[14%] flex h-6 w-6 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm ring-2 ring-brand-400">
            <Icon name="pin" className="h-3 w-3" />
          </span>

          <span className="busguard-float absolute left-[44%] top-[30%] flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white">
            <Icon name="bus" className="h-4.5 w-4.5" />
          </span>
        </div>

        <div className="px-4 py-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Arriving at your stop
              </p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-brand-700">
                4{" "}
                <span className="text-base font-medium text-slate-500">
                  min
                </span>
              </p>
            </div>
            <Badge tone="blue" dot>
              on time
            </Badge>
          </div>

          <Meter value={0.62} label="Trip progress" className="mt-4" />
          <p className="mt-2 text-[11px] text-slate-500">
            3 stops to go · next: Gandhi Nagar
          </p>

          {/* The confirmation a parent actually wants, and the one every other
              tracker on the market leaves out. */}
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Icon name="check" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-900">
                Aarav is on board
              </p>
              <p className="text-[11px] text-emerald-700">
                Picked up at 07:38 · Gandhi Nagar
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ValueStrip() {
  const points: { icon: IconName; text: string }[] = [
    { icon: "users", text: "Tracks students, not just vehicles" },
    { icon: "bell", text: "Approach, arrival and missed-bus alerts" },
    { icon: "phone", text: "Runs on any phone, with no app store" },
  ];

  return (
    <section className="border-y border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:grid-cols-3 sm:px-6">
        {points.map((point, i) => (
          <div
            key={point.text}
            className="busguard-rise flex items-center gap-3"
            style={staggerIndex(i)}
          >
            <IconBadge name={point.icon} tone="brand" size="md" />
            <p className="text-sm font-medium text-slate-700">{point.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="Everything the run needs"
          body="One system for the driver, the student, the parent and the office - so the bus sits in the same place on everybody's screen, and nobody is left guessing."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <div
              key={feature.title}
              className="busguard-lift group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              style={staggerIndex(i)}
            >
              <span className="busguard-tile inline-flex">
                <IconBadge name={feature.icon} tone="brand" size="lg" />
              </span>
              <h3 className="mt-4 text-sm font-semibold tracking-tight text-slate-900">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section id="how" className="scroll-mt-20 border-y border-slate-200 bg-slate-50 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="Set up once, then just watch"
          body="Three steps to a live bus. Only the install needs doing once."
        />

        <ol className="mt-12 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="busguard-rise relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              style={staggerIndex(i)}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <IconBadge name={step.icon} tone="brand" size="md" />
              </div>
              <h3 className="mt-4 text-sm font-semibold tracking-tight text-slate-900">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Roles() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Roles"
          title="Built for every role on the route"
          body="Each person sees the part of the run that concerns them, and nothing else."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role, i) => (
            <div
              key={role.title}
              className="busguard-lift group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              style={staggerIndex(i)}
            >
              <span className="busguard-tile inline-flex">
                <IconBadge name={role.icon} tone="brand" size="lg" />
              </span>
              <h3 className="mt-4 text-sm font-semibold tracking-tight text-slate-900">
                {role.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {role.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-brand-800 px-6 py-14 text-center sm:px-12">
        <div
          aria-hidden
          className="busguard-grid pointer-events-none absolute inset-0 opacity-50"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-emerald-400/20 blur-3xl"
        />

        <div className="relative">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Put your fleet on the map
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-brand-100">
            Create an account to follow your bus and get arrival alerts. Drivers
            and students sign in with the email the college registered for them.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="btn bg-white px-5 py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-50"
            >
              Create your account
              <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="btn border border-white/30 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark size={32} />
          <span className="text-sm font-semibold tracking-tight text-slate-900">
            BusGuard
          </span>
        </div>

        <nav aria-label="Footer" className="flex items-center gap-5">
          <Link
            href="/login"
            className="busguard-underline text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="busguard-underline text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Create account
          </Link>
        </nav>

        <p className="text-xs text-slate-500">
          Know where the bus is. Know your child is on it.
        </p>
      </div>
    </footer>
  );
}
