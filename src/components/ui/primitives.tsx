import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";
import { Icon, type IconName } from "./icon";

export type Tone =
  | "slate"
  | "emerald"
  | "amber"
  | "red"
  | "blue"
  | "violet"
  | "brand";

/**
 * Soft pill/tile fills: a tinted background with a readable foreground.
 *
 * These are the ones that have to pass contrast, because they sit *behind text*
 * (a `Badge`'s label, an icon is decorative but the number beside it is not).
 * The `inset-ring` gives each one a hairline edge so a pale tint does not read
 * as a rendering artefact on a white card.
 */
const TONE_SOFT: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 inset-ring-1 inset-ring-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 inset-ring-1 inset-ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 inset-ring-1 inset-ring-amber-200",
  red: "bg-red-50 text-red-700 inset-ring-1 inset-ring-red-200",
  blue: "bg-blue-50 text-blue-700 inset-ring-1 inset-ring-blue-200",
  violet: "bg-violet-50 text-violet-700 inset-ring-1 inset-ring-violet-200",
  brand: "bg-brand-50 text-brand-800 inset-ring-1 inset-ring-brand-200",
};

/**
 * Solid gradient stops.
 *
 * Used for two things, and never for text: accent bars on cards, and the fill of
 * a `Meter`. Both are decoration, so the stops are free to be as saturated as
 * they look good rather than as pale as a contrast checker demands.
 */
const TONE_GRADIENT: Record<Tone, string> = {
  slate: "bg-linear-to-br from-slate-500 to-slate-700",
  emerald: "bg-linear-to-br from-emerald-400 to-emerald-600",
  amber: "bg-linear-to-br from-amber-400 to-amber-600",
  red: "bg-linear-to-br from-red-400 to-red-600",
  blue: "bg-linear-to-br from-blue-500 to-blue-700",
  violet: "bg-linear-to-br from-violet-500 to-violet-700",
  brand: "bg-linear-to-br from-brand-400 to-brand-600",
};

/**
 * The colour of a big number.
 *
 * Every value here is checked against the white card behind it at the size the
 * tile actually renders it (24px), where WCAG's *large text* floor of 3:1
 * applies. The muted slate is deliberately the default rather than an accent -
 * a dashboard where every figure is coloured is a dashboard where colour has
 * stopped meaning "look here".
 */
const TONE_TEXT: Record<Tone, string> = {
  slate: "text-slate-900",
  emerald: "text-emerald-600",
  amber: "text-amber-700",
  red: "text-red-600",
  blue: "text-blue-600",
  violet: "text-violet-600",
  brand: "text-brand-700",
};

/**
 * Index for a stagger.
 *
 * `busguard-stagger` reads `--busguard-i` off each child and turns it into an
 * animation delay. Exposing this as a helper rather than making every call
 * site cast a custom property keeps the type cast in one place - inline
 * `style={{ "--busguard-i": i } as CSSProperties}` at twenty call sites is
 * twenty places to get the syntax subtly wrong, and the failure is silent.
 */
export function staggerIndex(index: number): CSSProperties {
  return { "--busguard-i": index } as CSSProperties;
}

export function Badge({
  children,
  tone = "slate",
  className,
  /** Adds a small status dot in the badge's own colour. */
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_SOFT[tone],
        className,
      )}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
      ) : null}
      {children}
    </span>
  );
}

/**
 * A tinted rounded square behind a single icon.
 *
 * Purely decorative - the icon inside is `aria-hidden` and the tile carries no
 * text - so it is safe to sit one of these next to any label without a screen
 * reader reading "graphic" before the word it belongs to. It exists to give a
 * card or a header a visual anchor, which a bullet point does not.
 */
export function IconBadge({
  name,
  tone = "brand",
  size = "md",
  className,
}: {
  name: IconName;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box = {
    sm: "h-7 w-7 rounded-lg",
    md: "h-9 w-9 rounded-xl",
    lg: "h-12 w-12 rounded-2xl",
  }[size];
  const glyph = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-6 w-6",
  }[size];

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        TONE_SOFT[tone],
        box,
        className,
      )}
    >
      <Icon name={name} className={glyph} />
    </span>
  );
}

export function Card({
  children,
  className,
  /** Adds the hover lift. Off by default: a lift on a dense data table row is
   *  motion without meaning. Turn it on for the standalone cards a pointer
   *  might plausibly click. */
  lift = false,
  /** A gradient hairline across the top edge, to group a card under a topic. */
  accent,
  /** Turn off when the card holds something edge-to-edge, like a table. */
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  lift?: boolean;
  accent?: Tone;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-slate-200 bg-white shadow-sm",
        padded && "p-5",
        lift && "busguard-lift",
        className,
      )}
    >
      {accent ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl",
            TONE_GRADIENT[accent],
          )}
        />
      ) : null}
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  hint,
  action,
  icon,
  tone = "brand",
  size = "sm",
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  tone?: Tone;
  /** `md` for a content page where the card *is* the section heading. */
  size?: "sm" | "md";
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <IconBadge name={icon} tone={tone} /> : null}
        <div className="min-w-0">
          <h2
            className={cn(
              "tracking-tight text-slate-900",
              size === "md"
                ? "text-base font-semibold"
                : "text-sm font-semibold",
            )}
          >
            {children}
          </h2>
          {hint ? (
            <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "slate",
  icon,
  trend,
}: {
  label: string;
  /**
   * A number animates when it changes; anything else is rendered as given.
   *
   * The union is deliberate. Every call site passes a count today, but
   * `ReactNode` was the signature before and loosening it back would be a
   * regression in type safety for no gain - the alternative is a separate
   * component for "a stat that is not a number", which is a component nobody
   * has asked for.
   */
  value: number | ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  /** A decorative glyph, top-right, to give the tile a face. */
  icon?: IconName;
  /** A direction plus a short label, e.g. `{ direction: "up", label: "+3" }`. */
  trend?: { direction: "up" | "down"; label: ReactNode };
}) {
  const numeric = typeof value === "number" ? value : null;

  return (
    <Card lift>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        {icon ? <IconBadge name={icon} tone={tone} size="sm" /> : null}
      </div>
      {/*
        `tabular-nums` lives inside CountUp. It has to be there rather than here:
        a proportional figure changes width as its digits change, so a counting
        number would shuffle the label above it on every frame. The tile sets the
        size and colour; the digits set the rhythm.
      */}
      <p className={cn("mt-3 text-2xl font-semibold tracking-tight", TONE_TEXT[tone])}>
        {numeric !== null ? <CountUp value={numeric} /> : value}
      </p>
      {sub || trend ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {trend ? (
            <TrendPill direction={trend.direction}>{trend.label}</TrendPill>
          ) : null}
          {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

/** A small up/down chip beside a statistic. */
export function TrendPill({
  direction,
  children,
}: {
  direction: "up" | "down";
  children: ReactNode;
}) {
  const up = direction === "up";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
        up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
      )}
    >
      {/* Decorative: the direction is already carried by the colour and the
          sign in `children`. Screen readers get the label, not "trending up". */}
      <Icon name={up ? "trendUp" : "trendDown"} className="h-3 w-3" />
      {children}
    </span>
  );
}

/**
 * A horizontal meter.
 *
 * `role="progressbar"` with an accessible name, because a bare bar communicates
 * nothing to a screen reader and axe flags a named-less one. The fill animates
 * with `scaleX` (`busguard-grow-x`) rather than `width`: width would reflow every
 * sibling on every frame, and a bar almost always has a sibling - the number
 * beside it.
 */
export function Meter({
  value,
  tone = "brand",
  label,
  className,
}: {
  /** 0..1. Clamped, so a bad caller cannot paint outside the track. */
  value: number;
  tone?: Tone;
  /** The accessible name. Required: an unnamed progressbar is invisible to AT. */
  label: string;
  className?: string;
}) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-slate-100",
        className,
      )}
    >
      <div
        className={cn("busguard-grow-x h-full rounded-full", TONE_GRADIENT[tone])}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

/**
 * Initials in a brand disc.
 *
 * Decorative by construction: the name it stands for is always rendered beside
 * it, so the disc is `aria-hidden` and a screen reader reads the name once
 * rather than the name and then two letters.
 */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const box = {
    sm: "h-8 w-8 text-xs",
    md: "h-9 w-9 text-sm",
    lg: "h-11 w-11 text-base",
  }[size];

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-brand-500 to-brand-700 font-semibold text-white shadow-sm",
        box,
        className,
      )}
    >
      {initials}
    </span>
  );
}

/**
 * Placeholder block for content that has not arrived.
 *
 * The shape is carried by the caller (`className` sets width and height)
 * because a skeleton that guesses its own size is a layout shift waiting to
 * happen - which is worse than an empty box.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("busguard-skeleton rounded-lg", className)}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-linear-to-b from-slate-50 to-white px-6 py-12 text-center">
      {icon ? (
        <IconBadge name={icon} tone="brand" size="lg" className="mb-4" />
      ) : null}
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * A rotating indicator for a pending action.
 *
 * Drawn in `currentColor` so it works on the primary button and anywhere else
 * without a colour prop: a filled ring with one transparent quarter reads as
 * motion, and the gap is what makes the rotation legible - a uniform ring
 * spinning looks static.
 *
 * `motion-reduce:animate-none` holds the project's rule that every animation can
 * be switched off. The button's own label already changes to "Signing in…", so
 * the spinner is decoration and losing it costs no information.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function StatusDot({
  online,
  label,
}: {
  online: boolean;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span className="relative flex h-2 w-2">
        {/*
          The ping is a second element rather than an animation on the dot
          itself, because `animate-ping` scales the element it is applied to -
          and that element is the only thing conveying state. A state
          indicator should never be the thing that shrinks.

          Decorative, so hidden from assistive tech; the word beside it is
          what actually carries the meaning.
        */}
        {online ? (
          <span
            aria-hidden
            className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
          />
        ) : null}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full transition-colors",
            online ? "bg-emerald-500" : "bg-slate-300",
          )}
        />
      </span>
      {label}
    </span>
  );
}
