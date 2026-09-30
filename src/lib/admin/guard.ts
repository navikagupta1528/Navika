import "server-only";
import { readSession } from "@/lib/session";
import { Role } from "@/generated/prisma/enums";

/**
 * Guard for every admin mutation.
 *
 * The admin pages already check the role, but a Server Action is a public HTTP
 * endpoint that can be invoked directly with a crafted request — hiding the
 * button does not protect the action. So every action checks again here and
 * throws, which surfaces as a 500 rather than silently succeeding.
 */
export async function assertAdmin(): Promise<string> {
  const session = await readSession();
  if (!session || session.role !== Role.ADMIN) {
    throw new Error("Unauthorized: admin access required");
  }
  return session.userId;
}
