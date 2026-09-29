import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession, type SessionPayload } from "@/lib/session";
import { Role } from "@/generated/prisma/enums";

/**
 * Data Access Layer. Every read that depends on the current user goes through
 * here, so the session check and the role check are impossible to forget.
 *
 * `cache` memoises within a single render pass, so a page that calls this in
 * both the layout and the page only hits the database once.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  return readSession();
});

/** Throws the visitor to /login when there is no valid session. */
export const requireSession = cache(async (): Promise<SessionPayload> => {
  const session = await readSession();
  if (!session) redirect("/login");
  return session;
});

/** Throws the visitor to their own dashboard when the role does not match. */
export const requireRole = cache(
  async (...roles: Role[]): Promise<SessionPayload> => {
    const session = await readSession();
    if (!session) redirect("/login");
    if (!roles.includes(session.role)) {
      redirect(homeForRole(session.role));
    }
    return session;
  },
);

export function homeForRole(role: Role | string): string {
  switch (role) {
    case Role.ADMIN:
      return "/admin";
    case Role.DRIVER:
      return "/driver";
    case Role.PARENT:
      return "/parent";
    default:
      return "/student";
  }
}

/**
 * The signed-in user with role-appropriate profile data. This is the only
 * user object that may be passed to a Client Component — it carries no
 * password hash.
 */
export const getCurrentUser = cache(async () => {
  const session = await readSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      studentProfile: {
        select: {
          id: true,
          enrollmentNo: true,
          department: true,
          yearOfStudy: true,
          guardians: {
            select: {
              parent: {
                select: {
                  id: true,
                  userId: true,
                  user: { select: { id: true, name: true, email: true, phone: true } },
                },
              },
            },
          },
        },
      },
      parentProfile: {
        select: {
          id: true,
          relation: true,
          children: {
            select: {
              student: {
                select: {
                  id: true,
                  enrollmentNo: true,
                  department: true,
                  yearOfStudy: true,
                  user: { select: { id: true, name: true, email: true, phone: true } },
                },
              },
            },
          },
        },
      },
      driverProfile: {
        select: {
          id: true,
          licenseNo: true,
          licenseExpiry: true,
          experienceYr: true,
        },
      },
    },
  });

  if (!user || !user.isActive) return null;
  return user;
});

/** Like requireRole, but returns null instead of redirecting. */
export const getUserIfRole = cache(async (...roles: Role[]) => {
  const session = await readSession();
  if (!session || !roles.includes(session.role)) return null;
  const user = await getCurrentUser();
  return user ?? null;
});
