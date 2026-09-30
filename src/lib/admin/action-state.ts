/**
 * Shape shared by every admin Server Action.
 *
 * Server Actions return this instead of throwing, so the form can render the
 * problem next to the field that caused it rather than showing a dead page.
 */
export type ActionState =
  | {
      ok?: boolean;
      message?: string;
      /** Field name -> first validation message. */
      errors?: Record<string, string | undefined>;
    }
  | undefined;

/** Zod v4 keeps the whole tree on `error.issues`. */
export function firstErrors(
  error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } },
): Record<string, string | undefined> {
  const flat = error.flatten().fieldErrors;
  const out: Record<string, string | undefined> = {};
  for (const [key, messages] of Object.entries(flat)) {
    if (messages?.[0]) out[key] = messages[0];
  }
  return out;
}

/** Prisma error code for a unique-constraint violation. */
export const UNIQUE_VIOLATION = "P2002";

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === UNIQUE_VIOLATION
  );
}

/**
 * Turn a Prisma failure into a message an admin can act on.
 *
 * The raw Prisma errors mention table and column names, which is noise for the
 * person using the screen, so they are translated per call site instead.
 */
export function describeWriteError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code: string }).code === UNIQUE_VIOLATION) {
      return "That value is already used by another record.";
    }
    if ((error as { code: string }).code === "P2025") {
      return "That record no longer exists. It may have been deleted.";
    }
  }
  console.error("[admin] write failed:", error);
  return "Something went wrong saving. Check the server log.";
}
