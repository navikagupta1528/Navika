"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import { createSession, destroySession } from "@/lib/session";
import { homeForRole } from "@/lib/dal";
import {
  checkThrottle,
  lockedOutMessage,
  recordFailure,
  recordSuccess,
} from "@/lib/login-guard";
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

  /*
   * Throttle before the password is looked at, not after.
   *
   * bcrypt at cost 12 is deliberately slow, which is what makes an offline guess
   * expensive - and it is also what makes an *online* guess expensive to us for
   * free. But "expensive per attempt" is not "bounded in total", and without this
   * a script could guess forever against the system that reports where children
   * are. Refusing first means we do not pay bcrypt on an attempt we already know
   * we are going to turn away.
   *
   * The throttle is keyed on the submitted address before any lookup, and every
   * failure below is charged to it. That is deliberate: if only accounts that
   * existed were counted, an attacker would learn which addresses are real by
   * watching who gets locked out.
   */
  const throttle = await checkThrottle("login", parsed.data.email);
  if (!throttle.ok) {
    return { message: lockedOutMessage(throttle.retryAfterSeconds) };
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
    await recordFailure("login", parsed.data.email);
    return invalid;
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    await recordFailure("login", parsed.data.email);
    return invalid;
  }

  // A deactivated account is not a failed password, so it is not charged to the
  // throttle - otherwise a locked-out user's only way to discover their account
  // was switched off would be to keep guessing at it.
  if (!user.isActive) {
    return { message: "This account has been deactivated. Contact your admin." };
  }

  // Only now, with the password known good, does the counter get cleared.
  await recordSuccess("login", parsed.data.email);
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

  /*
   * Registration is throttled, and for a different reason than sign-in.
   *
   * The form tells you whether an address is taken, and it has to: someone
   * signing up with the wrong address needs to find out. But that reply is an
   * account oracle - the roster of registered addresses is the roster of students
   * and their guardians - so without a limit the whole list can be walked
   * unattended at whatever rate the script allows.
   *
   * Counting a rejection as a failure is what bounds that walk. The rate becomes
   * a handful of probes per window instead of unlimited, while a legitimate user
   * who mistypes their own address loses nothing beyond a thirty-second wait.
   *
   * A separate budget from sign-in, so the four accounts a college office creates
   * from one shared address cannot lock out every student behind that address.
   */
  const throttle = await checkThrottle("register", data.email);
  if (!throttle.ok) {
    return { message: lockedOutMessage(throttle.retryAfterSeconds) };
  }

  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) {
    await recordFailure("register", data.email);
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
      // Also an oracle: enrollment numbers are sequential, so an unthrottled walk
      // of them is a walk of the whole student body.
      await recordFailure("register", data.email);
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
    await recordFailure("register", data.email);
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

  await recordSuccess("register", data.email);
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
