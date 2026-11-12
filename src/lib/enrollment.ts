/**
 * Roll numbers, normalised in exactly one place.
 *
 * The seed stores `25cse01`, the sign-in form lower-cases whatever is typed,
 * and the registration form writes what the student entered. Without a shared
 * normaliser those three drift: `25CSE01` registers fine and then cannot sign
 * in, because the login query looks for `25cse01` and the row says `25CSE01`.
 *
 * Pure and framework-free so the Server Action, the registration form and the
 * tests can all use it.
 */
export function normaliseEnrollmentNo(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * Does this look like a roll number rather than an email address or username?
 *
 * Used only for copy and for choosing a placeholder; the login query itself
 * matches email OR username, so a user who types an email here still works.
 */
export function looksLikeRollNumber(value: string): boolean {
  return /^\d{2}[a-z]{2,4}\d{1,3}$/.test(normaliseEnrollmentNo(value));
}
