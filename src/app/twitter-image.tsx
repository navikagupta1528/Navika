/**
 * The Twitter/X card. Identical to the Open Graph card on purpose - there is one
 * brand card, and two files because Next.js treats the conventions separately,
 * not because the two should look different.
 *
 * Re-exported rather than duplicated so the two can never drift: editing
 * `opengraph-image.tsx` updates both.
 */
export { alt, size, contentType, default } from "./opengraph-image";
