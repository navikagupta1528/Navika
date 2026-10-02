import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "slate" | "emerald" | "amber" | "red" | "blue" | "violet";

const TONE_CLASSES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 inset-ring-1 inset-ring-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 inset-ring-1 inset-ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 inset-ring-1 inset-ring-amber-200",
  red: "bg-red-50 text-red-700 inset-ring-1 inset-ring-red-200",
  blue: "bg-blue-50 text-blue-700 inset-ring-1 inset-ring-blue-200",
  violet: "bg-violet-50 text-violet-700 inset-ring-1 inset-ring-violet-200",
};

/**
 * Index for a stagger.
 *
 * `navika-stagger` reads `--navika-i` off each child and turns it into an
 * animation delay. Exposing this as a helper rather than making every call
 * site cast a custom property keeps the type cast in one place - inline
 * `style={{ "--navika-i": i } as CSSProperties}` at twenty call sites is
 * twenty places to get the syntax subtly wrong, and the failure is silent.
 */
export function staggerIndex(index: number): CSSProperties {
  return { "--navika-i": index } as CSSProperties;
}

export function Badge({
  children,
  tone = "slate",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
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
}: {
  children: ReactNode;
  className?: string;
  lift?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-5 shadow-sm",
        lift && "navika-lift",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          {children}
        </h2>
        {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
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
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  const accent: Record<Tone, string> = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
    blue: "text-blue-600",
    violet: "text-violet-600",
  };

  return (
    <Card lift>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", accent[tone])}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </Card>
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
      className={cn("navika-skeleton rounded-lg", className)}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
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