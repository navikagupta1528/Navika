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
 * The pulsing is disabled under `prefers-reduced-motion` by a rule in
 * `globals.css`, since the utility class is applied from markup and there is no
 * variant that can override it from here.
 */
export default function PortalLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div aria-hidden="true" className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-slate-200" />
        <div className="h-4 w-80 animate-pulse rounded-md bg-slate-100" />
      </div>

      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>

      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}