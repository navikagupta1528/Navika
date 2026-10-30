/**
 * Loading state for the portal.
 *
 * WHAT THIS IS TRYING NOT TO BE.
 *
 * A centred spinner. The two screens people open most on a bus app - the fleet map
 * and a parent's child view - are the slowest to load, and a spinner in the middle
 * of a white page for two seconds tells the user nothing about what is coming.
 *
 * Skeletons that match the layout they replace mean the page does not jump when
 * the data arrives. The tile row is the clearest case: every dashboard opens on
 * four `StatTile`s, they are the tallest thing above the fold, and a fallback
 * that guessed a different height would shove everything below it down at the
 * moment the data landed - a layout shift caused entirely by the placeholder.
 * The dimensions here are copied from `StatTile` and `PageHeader` rather than
 * eyeballed, and `rounded-2xl` matches the card radius the pages actually use.
 *
 * The blocks are `aria-hidden` and the wrapper carries the accessible label: a
 * screen reader announcing "loading, loading, loading" once per block is worse
 * than announcing it once.
 *
 * The blocks use `Skeleton`, which sweeps a highlight rather than pulsing the
 * whole box. A pulse on a full-width block reads as the page flickering; a
 * sweep reads as one surface, which is what a loading state actually is.
 *
 * Motion here is gated in `globals.css` under `prefers-reduced-motion:
 * no-preference`, so a reduced-motion visitor gets static blocks with the
 * same dimensions - the layout stability is what matters, not the animation.
 *
 * The two grids carry `busguard-stagger`, so the blocks arrive left to right
 * instead of all at once. The header above them does not: it is not in a
 * grid, and animating it would compete with the page title it stands in for.
 */
import { Skeleton } from "@/components/ui/primitives";

export default function PortalLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/*
        The `PageHeader` shape: a 12x12 icon tile beside a title and a
        description. It is the same geometry as `IconBadge size="lg"` plus the
        two text lines, so the real header drops in without moving anything.
      */}
      <div aria-hidden="true" className="flex items-start gap-3">
        <Skeleton className="h-12 w-12 rounded-2xl bg-slate-200" />
        <div className="space-y-2 pt-1">
          <Skeleton className="h-6 w-56 rounded-md bg-slate-200" />
          <Skeleton className="h-4 w-80 rounded-md bg-slate-100" />
        </div>
      </div>

      <div
        aria-hidden="true"
        className="busguard-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-28 rounded-2xl bg-slate-100"
          />
        ))}
      </div>

      <div
        aria-hidden="true"
        className="busguard-stagger grid gap-6 lg:grid-cols-[1fr_20rem]"
      >
        <Skeleton className="h-72 rounded-2xl bg-slate-100" />
        <Skeleton className="h-72 rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}
