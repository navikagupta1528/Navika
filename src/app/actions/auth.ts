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
import { registerSchema } from "@/lib/validations";
import { normaliseEnrollmentNo } from "@/lib/enrollment";
import { Role } from "@/generated/prisma/enums";

export type AuthState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
} | undefined;

function flatten(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return error.flatten().fieldErrors;
}

/**
 * The sign-in pages are split by role, and each one posts its own `role` field.
 *
 * Enforcing it here rather than only in the UI is what makes the split real: a
 * parent who lands on the student page is told to use the right one instead of
 * being signed in and then bounced by the proxy, which reads as a broken login.
 */
const LOGIN_ROLES = ["STUDENT", "PARENT", "DRIVER", "ADMIN"] as const;
type LoginRole = (typeof LOGIN_ROLES)[number];

const ROLE_LABEL: Record<LoginRole, string> = {
  STUDENT: "student",
  PARENT: "parent",
  DRIVER: "driver",
  ADMIN: "administrator",
};

function loginRole(value: FormDataEntryValue | null): LoginRole | null {
  const role = String(value ?? "").trim().toUpperCase();
  return (LOGIN_ROLES as readonly string[]).includes(role) ? (role as LoginRole) : null;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const rawIdentifier = String(
    formData.get("email") || formData.get("username") || formData.get("identifier") || "",
  ).trim();
  // Roll numbers are stored lower-case; emails and usernames are too. Lower-case
  // the whole identifier so `25CSE01`, `25Cse01` and `25cse01` are one account.
  const identifier = rawIdentifier.toLowerCase();
  const password = String(formData.get("password") || "");
  const expectedRole = loginRole(formData.get("role"));

  if (!identifier || !password) {
    return { errors: { email: ["Username/Roll No. and password are required"] } };
  }

  const throttle = await checkThrottle("login", identifier);
  if (!throttle.ok) {
    return { message: lockedOutMessage(throttle.retryAfterSeconds) };
  }

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { username: identifier },
      ],
    },
    select: {
      id: true,
      passwordHash: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
    },
  });

  if (!user && identifier.includes("@")) {
    user = await prisma.user.findUnique({
      where: { email: identifier },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
      },
    });
  }

  const invalid = { message: "Incorrect email/username or password." };

  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    await recordFailure("login", identifier);
    return invalid;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await recordFailure("login", identifier);
    return invalid;
  }

  if (!user.isActive) {
    return { message: "This account has been deactivated. Contact your admin." };
  }

  /*
   * The password was right, so naming the role costs nothing: the person already
   * knows the account exists. Refusing here is what keeps `/login`, `/login/parent`,
   * `/login/driver` and `/login/admin` meaningful instead of decorative.
   */
  if (expectedRole && user.role !== expectedRole) {
    return {
      message: `This account is not a ${ROLE_LABEL[expectedRole]} account. Use the ${ROLE_LABEL[user.role]} sign-in page.`,
    };
  }

  await recordSuccess("login", identifier);
  const rememberMe = formData.get("rememberMe") === "1";
  await createSession({ userId: user.id, role: user.role, mustChangePassword: user.mustChangePassword }, rememberMe);
  if (user.mustChangePassword) {
    redirect("/change-password");
  }
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
    enrollmentNo: normaliseEnrollmentNo(formData.get("enrollmentNo")) || undefined,
    department: formData.get("department") || undefined,
    yearOfStudy: formData.get("yearOfStudy") || undefined,
    relation: formData.get("relation") || undefined,
    childEnrollmentNo: normaliseEnrollmentNo(formData.get("childEnrollmentNo")) || undefined,
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
      // Students sign in with their roll number, so the enrollment number is
      // stored as the username too. Lower-cased because the login action
      // lower-cases whatever is typed, and the two must agree.
      // Parents and admins sign in with their email address.
      username:
        role === Role.STUDENT && data.enrollmentNo
          ? data.enrollmentNo.toLowerCase()
          : null,
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
// Complete profile + set password (first time)
// ---------------------------------------------------------------------------

export async function completeProfile(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const { requireSession } = await import("@/lib/dal");
    const session = await requireSession();
    const name = String(formData.get("name") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (!name) return { message: "Name is required." };
    if (!phone) return { message: "Phone number is required." };
    if (newPassword.length < 6) return { message: "Password must be at least 6 characters." };
    if (newPassword !== confirmPassword) return { message: "Passwords do not match." };

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: session.userId },
      data: { name, phone, passwordHash, mustChangePassword: false },
    });

    if (session.role === "DRIVER") {
      const licenseNo = String(formData.get("licenseNo") || "").trim();
      const licenseExpiry = formData.get("licenseExpiry") ? new Date(String(formData.get("licenseExpiry"))) : null;
      const experienceYr = formData.get("experienceYr") ? Number(formData.get("experienceYr")) : 0;
      if (licenseNo) {
        await prisma.driverProfile.upsert({
          where: { userId: session.userId },
          update: { licenseNo, licenseExpiry, experienceYr },
          create: { userId: session.userId, licenseNo, licenseExpiry, experienceYr },
        });
      }
    }

    await createSession({ userId: session.userId, role: session.role, mustChangePassword: false });
    redirect(homeForRole(session.role));
  } catch (error) {
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) throw error;
    return { message: "Something went wrong." };
  }
}

// ---------------------------------------------------------------------------
// Change password (self or forced)
// ---------------------------------------------------------------------------

export async function changePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const { requireSession } = await import("@/lib/dal");
    const session = await requireSession();
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (newPassword.length < 6) {
      return { message: "Password must be at least 6 characters." };
    }
    if (newPassword !== confirmPassword) {
      return { message: "Passwords do not match." };
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash, mustChangePassword: false },
    });

    await createSession({ userId: session.userId, role: session.role, mustChangePassword: false });
    redirect(homeForRole(session.role));
  } catch (error) {
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) throw error;
    return { message: "Something went wrong." };
  }
}

// ---------------------------------------------------------------------------
// Admin: reset password for student/parent
// ---------------------------------------------------------------------------

export async function adminResetPassword(formData: FormData): Promise<AuthState> {
  try {
    const { requireRole } = await import("@/lib/dal");
    await requireRole(Role.ADMIN);
    const userId = String(formData.get("userId") || "");
    const newPassword = String(formData.get("newPassword") || "");

    if (!userId || newPassword.length < 6) {
      return { message: "Invalid input." };
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target) return { message: "User not found." };
    if (target.role === Role.DRIVER || target.role === Role.ADMIN) {
      return { message: "Cannot reset password for this role." };
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
    });
    return { message: "Password reset. User will be asked to change on next login." };
  } catch (error) {
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) throw error;
    return { message: "Something went wrong." };
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
