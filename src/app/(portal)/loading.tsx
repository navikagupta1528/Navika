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
 * the data arrives. On the map in particular, the map controls and legend are in
 * fixed positions, so a skeleton holds those still instead of letting them snap
 * into place after the tiles load.
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
 * The two grids carry `navika-stagger`, so the blocks arrive left to right
 * instead of all at once. The header above them does not: it is not in a
 * grid, and animating it would compete with the page title it stands in for.
 */
import { Skeleton } from "@/components/ui/primitives";

export default function PortalLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-7 w-56 rounded-md bg-slate-200" />
        <Skeleton className="h-4 w-80 rounded-md bg-slate-100" />
      </div>

      <div
        aria-hidden="true"
        className="navika-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-20 rounded-xl bg-slate-100"
          />
        ))}
      </div>

      <div
        aria-hidden="true"
        className="navika-stagger grid gap-6 lg:grid-cols-[1fr_20rem]"
      >
        <Skeleton className="h-72 rounded-xl bg-slate-100" />
        <Skeleton className="h-72 rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}