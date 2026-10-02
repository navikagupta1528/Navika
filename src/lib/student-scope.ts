import "server-only";
import { Role } from "@/generated/prisma/enums";

/**
 * The Prisma filter that narrows students down to "the ones this user is".
 *
 * Exists because this is easy to get wrong in a way TypeScript does not always
 * catch. The natural-looking `student: { parentProfile: { userId } }` reads well
 * and is nonsense: `StudentProfile` has no `parentProfile` field. The link runs
 * the other way — `StudentProfile.guardians` is a list of `ParentChild` rows,
 * each pointing at a `ParentProfile`, and it is that profile that carries
 * `userId`.
 *
 * That mistake is worth a module of its own because it has two failure modes
 * and they are both bad. Where the union happens to resolve to a laxer branch it
 * compiles clean and then throws a Prisma validation error at runtime, on the
 * exact code path that decides whether a parent may see their child. And the
 * alternative — inlining `{ userId }` for a student — looks interchangeable but
 * silently matches nothing for a parent, which is worse: it fails closed with
 * an empty result and no error at all.
 *
 * One function, used by every place that needs to ask "is this student mine",
 * so the answer cannot differ between the page that lists and the action that
 * writes.
 */
export function studentScopeFor(
  userId: string,
  role: Role,
): { userId: string } | { guardians: { some: { parent: { userId: string } } } } {
  return role === Role.STUDENT ? { userId } : { guardians: { some: { parent: { userId } } } };
}

/**
 * The same scope, shaped for a `Bus`-level `where`.
 *
 * A bus is watchable by this user when any *active* enrolment on it belongs to
 * one of their students. Used by the fleet page to decide which buses to offer
 * a "follow" link for.
 */
export function busScopeFor(userId: string, role: Role) {
  return { enrollments: { some: { isActive: true, student: studentScopeFor(userId, role) } } };
}
