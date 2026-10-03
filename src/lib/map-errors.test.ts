import { describe, expect, it } from "vitest";
import { classifyMapError, mapFailureMessage, type MapFailure } from "./map-errors";

/**
 * These tests exist because of a specific shipped mistake, and that mistake
 * cost more debugging time than the tests will take to write.
 *
 * The map listened for errors with one regex and reported every match as a tile
 * or style failure. That regex also matched MapLibre's worker failure, so a
 * broken engine was announced to the user as somebody else's server being
 * down. Nothing in the code was lying about what it *believed* - which is what
 * made it so hard to see: the message was accurate about the symptom and wrong
 * about the cause, and the cause is the only part worth knowing.
 *
 * So the load-bearing assertions below are the ones about *which* system failed.
 */

describe("classifyMapError", () => {
  it("calls the worker failure a worker failure, not a tile failure", () => {
    // The exact string MapLibre emits, and the exact string that was misread.
    const message = "Worker failed to load. Check that the worker URL is correct.";
    expect(classifyMapError(message)).toBe("worker");

    // The old filter matched this on "failed to load" and nothing else. Assert
    // it directly so the regression cannot come back by a different route.
    expect(/style|json|not found|failed to load/i.test(message)).toBe(true);
  });

  it("matches the worker case regardless of capitalisation or surrounding text", () => {
    for (const message of [
      "Worker failed to load.",
      "worker failed to load",
      "Failed to instantiate worker",
      "AJAXError: Failed to fetch (worker script)",
    ]) {
      expect(classifyMapError(message)).toBe("worker");
    }
  });

  it("calls a missing or refused tile a source failure", () => {
    for (const message of [
      "AJAXError: Not Found",
      "AJAXError: Failed to fetch https://tile.openstreetmap.org/10/734/447.png",
      "AJAXError: Failed to load https://tile.openstreetmap.org/10/734/447.png",
      "AJAXError: 403 Forbidden",
    ]) {
      expect(classifyMapError(message)).toBe("source");
    }
  });

  it("calls a style, sprite or glyph failure a source failure", () => {
    for (const message of [
      "AJAXError: Error 404 loading style",
      "Failed to load glyphs",
      "Failed to load sprite",
    ]) {
      expect(classifyMapError(message)).toBe("source");
    }
  });

  it("treats an absent message as nothing worth surfacing", () => {
    // MapLibre raises error events with an empty error object in places. Reading
    // `?.message` off nothing must not be mistaken for a broken map - the screen
    // would empty itself over an event that carried no information.
    expect(classifyMapError(undefined)).toBe("none");
    expect(classifyMapError(null)).toBe("none");
    expect(classifyMapError("")).toBe("none");
  });

  it("assumes a source failure when the text is unfamiliar", () => {
    /*
     * The deliberate worst case, and the one judgement call here.
     *
     * MapLibre's messages are human-readable strings from a bundled library, not
     * a stable contract, so an unrecognised one is the common case after any
     * upgrade rather than an edge case. Falling through to "none" would hide a
     * map that genuinely stopped working; falling through to "source" shows the
     * user the honest version - the map may not load - and puts the real text in
     * the console for whoever can read it.
     *
     * If this ever needs inverting, the answer is not "match more strings" but a
     * source-level check, because the text was never the reliable signal.
     */
    expect(classifyMapError("Error: something new happened in v6.12.0")).toBe("source");
  });

  it("is case-insensitive, because the library's casing is not a contract either", () => {
    expect(classifyMapError("AJAXERROR: NOT FOUND")).toBe("source");
    expect(classifyMapError("Worker Failed To Load")).toBe("worker");
  });
});

describe("mapFailureMessage", () => {
  it("blames the right system in each case", () => {
    /*
     * "The map engine" and "the map background" are the two halves, named the way
     * a reader would describe them. The point is not the wording - it is that the
     * two messages are *different*, so the page can no longer send every failure
     * to the same reader with the same explanation.
     */
    const worker = mapFailureMessage("worker");
    const source = mapFailureMessage("source");
    expect(worker).not.toBe(source);
    expect(worker).not.toContain("tile");
    expect(source).not.toContain("worker");
  });

  it("always keeps the page usable by pointing at the tables", () => {
    for (const failure of ["worker", "source"] as const) {
      expect(mapFailureMessage(failure)).toContain("tables on this page");
    }
  });

  it("says nothing when nothing is wrong", () => {
    // Rendered unconditionally under the heading, so "none" has to be an empty
    // string rather than a reassuring sentence about a working map.
    expect(mapFailureMessage("none")).toBe("");
  });

  it("covers every failure it is given", () => {
    const all: MapFailure[] = ["none", "worker", "source"];
    for (const failure of all) {
      expect(typeof mapFailureMessage(failure)).toBe("string");
    }
  });
});