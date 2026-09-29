"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import { createSession, destroySession } from "@/lib/session";
import { homeForRole } from "@/lib/dal";
import { loginSchema, registerSchema } from "@/lib/validations";
import { Role } from "@/generated/prisma/enums";

export type AuthState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
} | undefined;

function flatten(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return error.flatten().fieldErrors;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: flatten(parsed.error) };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      passwordHash: true,
      role: true,
      isActive: true,
    },
  });

  // Same message for unknown email and wrong password so the form does not
  // reveal which accounts exist.
  const invalid = { message: "Incorrect email or password." };

  if (!user) {
    // Burn comparable time to avoid leaking account existence via timing.
    await verifyPassword(parsed.data.password, DUMMY_HASH);
    return invalid;
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return invalid;

  if (!user.isActive) {
    return { message: "This account has been deactivated. Contact your admin." };
  }

  await createSession({ userId: user.id, role: user.role });
  redirect(homeForRole(user.role));
}

// bcrypt hash of a random string, only ever compared against. Keeps the
// failed-login path roughly as slow as the real one.
const DUMMY_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEeO1cYl1F1Y0Y0Y0Y0Y0Y0Y0Y0Y0Y0Y0Y0Y";

// ---------------------------------------------------------------------------
// Register — students and parents only
// ---------------------------------------------------------------------------

export async function register(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    role: formData.get("role"),
    phone: formData.get("phone") || undefined,
    enrollmentNo: formData.get("enrollmentNo") || undefined,
    department: formData.get("department") || undefined,
    yearOfStudy: formData.get("yearOfStudy") || undefined,
    relation: formData.get("relation") || undefined,
    childEnrollmentNo: formData.get("childEnrollmentNo") || undefined,
  });

  if (!parsed.success) {
    return { errors: flatten(parsed.error) };
  }

  const data = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) {
    return { errors: { email: ["An account with this email already exists"] } };
  }

  const passwordHash = await hashPassword(data.password);
  const role = data.role === "PARENT" ? Role.PARENT : Role.STUDENT;

  if (role === Role.STUDENT) {
    const taken = await prisma.studentProfile.findUnique({
      where: { enrollmentNo: data.enrollmentNo },
      select: { id: true },
    });
    if (taken) {
      return {
        errors: { enrollmentNo: ["This enrollment number is already registered"] },
      };
    }
  }

  const child =
    role === Role.PARENT
      ? await prisma.studentProfile.findUnique({
          where: { enrollmentNo: data.childEnrollmentNo },
          select: { id: true },
        })
      : null;

  if (role === Role.PARENT && !child) {
    return {
      errors: {
        childEnrollmentNo: [
          "No student found with that enrollment number. Ask your college office to add the student first.",
        ],
      },
    };
  }

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      phone: data.phone || null,
      role,
      studentProfile:
        role === Role.STUDENT
          ? {
              create: {
                enrollmentNo: data.enrollmentNo,
                department: data.department || null,
                yearOfStudy: data.yearOfStudy ?? null,
              },
            }
          : undefined,
      parentProfile:
        role === Role.PARENT
          ? {
              create: {
                relation: data.relation ?? "GUARDIAN",
                children: child ? { create: [{ studentId: child.id }] } : undefined,
              },
            }
          : undefined,
    },
    select: { id: true, role: true },
  });

  await createSession({ userId: user.id, role: user.role });
  redirect(homeForRole(user.role));
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
