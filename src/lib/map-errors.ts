/**
 * Telling apart the ways a MapLibre map can fail, so the page can say which.
 *
 * Pure: strings in, a verdict out. The map's error listener does the wiring, and
 * this decides what a failure *means* - which is exactly the part worth testing,
 * because getting it wrong is not a cosmetic problem.
 *
 * WHY THIS EXISTS
 * ---------------
 * The map used to react to any error whose text matched
 *
 *     /style|json|not found|failed to load/i
 *
 * and show "the map tiles or style could not be loaded". MapLibre raises that
 * same-shaped event when its background worker will not start:
 *
 *     Worker failed to load. Check that the worker URL is correct.
 *
 * which matches on "failed to load" and nothing else. So a failure in the engine
 * was reported to the user as a failure in the tile server - a different system,
 * a different owner, a different fix - and the page said so with confidence.
 *
 * That is not a hypothetical cost. It sent the investigation to the tile host
 * when the fault was in the worker, and the tile host was reachable the whole
 * time. A message that is confidently wrong is worse than one that is vague,
 * because it stops anyone looking further.
 *
 * So: classify first, then speak. The user is told which half broke, and the
 * real text is always logged regardless of what is shown.
 */

/** What, specifically, stopped working. */
export type MapFailure =
  /** Nothing worth surfacing. */
  | "none"
  /** The worker could not start, so the engine cannot parse anything. */
  | "worker"
  /** A source - the base tiles, a sprite, glyphs - could not be fetched. */
  | "source";

/**
 * Classify a MapLibre error message.
 *
 * Order matters and is the whole design. The worker test runs first and
 * deliberately does not lean on "failed to load", because that phrase is shared
 * with source failures and would re-merge the two cases this exists to separate.
 * It anchors on "worker", which is the one word only the engine failure has.
 *
 * Everything after that is best-effort. MapLibre's messages are not a stable
 * contract - they are human-readable strings from a bundled library - so the
 * aim is to be right about the common shapes, not to claim certainty about text
 * that can change in any patch release. Unrecognised text falls through to
 * "source" rather than "none", on purpose: silence hides a broken map, whereas
 * the honest worst case for an unknown failure is that the user is told the map
 * may not load.
 */
export function classifyMapError(message: string | undefined | null): MapFailure {
  if (!message) return "none";

  const text = message.toLowerCase();

  // Anchored on "worker", not on the shape of the sentence.
  if (text.includes("worker")) return "worker";

  if (
    text.includes("style") ||
    text.includes("sprite") ||
    text.includes("glyphs") ||
    text.includes("ajaxerror") ||
    text.includes("not found") ||
    text.includes("failed to fetch") ||
    text.includes("failed to load")
  ) {
    return "source";
  }

  return "source";
}

/**
 * What to tell the user, per failure.
 *
 * Both say the tables carry the same information, because that is true either
 * way and it is the part that keeps the screen usable. They differ in which
 * system to blame, which is the whole reason for classifying.
 *
 * Deliberately not diagnostic. The concrete message goes to the console; the
 * page says what is broken and what still works. A support answer is better for
 * both sides than a paragraph of speculation on the screen itself.
 */
export function mapFailureMessage(failure: MapFailure): string {
  switch (failure) {
    case "worker":
      return "The map engine could not start on this browser. The tables on this page carry the same information.";
    case "source":
      return "The map background could not be loaded. Check your connection, or try again shortly. The tables on this page carry the same information.";
    case "none":
      return "";
  }
}