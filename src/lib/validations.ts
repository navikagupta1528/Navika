import { z } from "zod";

export const loginSchema = z.object({
  email: z.email({ error: "Enter a valid email address" }).trim().toLowerCase(),
  password: z.string().min(1, { error: "Password is required" }),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Self-registration is deliberately limited to STUDENT and PARENT.
 *
 * A previous version of this project accepted `role` from the request body,
 * which let anyone POST /register with role=ADMIN and take over the system.
 * DRIVER and ADMIN accounts must be created by an existing admin.
 */
export const registerSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Name must be at least 2 characters" }),
    email: z.email({ error: "Enter a valid email address" }).trim().toLowerCase(),
    password: z
      .string()
      .min(8, { error: "Password must be at least 8 characters" })
      .regex(/[a-zA-Z]/, { error: "Password must contain a letter" })
      .regex(/[0-9]/, { error: "Password must contain a number" }),
    confirmPassword: z.string(),
    role: z.enum(["STUDENT", "PARENT"]),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s()]{7,15}$/, { error: "Enter a valid phone number" })
      .optional()
      .or(z.literal(""))
      .default(""),
    // student-only
    enrollmentNo: z.string().trim().default(""),
    department: z.string().trim().default(""),
    yearOfStudy: z.coerce.number().int().min(1).max(5).optional(),
    // parent-only
    relation: z.enum(["MOTHER", "FATHER", "GUARDIAN"]).optional(),
    // linking a parent to an existing student by enrollment number
    childEnrollmentNo: z.string().trim().default(""),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((v) => v.role !== "STUDENT" || v.enrollmentNo.length > 0, {
    message: "Enrollment number is required for students",
    path: ["enrollmentNo"],
  })
  .refine((v) => v.role !== "PARENT" || v.childEnrollmentNo.length > 0, {
    message: "Your child's enrollment number is required to link a parent account",
    path: ["childEnrollmentNo"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const locationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKph: z.number().min(0).max(200).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  accuracyM: z.number().min(0).optional(),
  recordedAt: z.coerce.date().optional(),
});

export const waitingPingSchema = z.object({
  stopId: z.string().min(1),
  tripId: z.string().min(1).optional(),
});

export const pickupUpdateSchema = z.object({
  pickupRecordId: z.string().min(1),
  status: z.enum(["PICKED", "MISSED", "PENDING", "WAITING"]),
});

export const stopArrivalSchema = z.object({
  tripId: z.string().min(1),
  stopId: z.string().min(1),
  arrivedAt: z.coerce.date().optional(),
});

export const alertSchema = z.object({
  tripId: z.string().optional(),
  busId: z.string().min(1),
  type: z.enum(["EMERGENCY", "BREAKDOWN", "ACCIDENT", "DELAY", "OTHER"]),
  message: z.string().trim().min(3).max(500),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const stopSchema = z.object({
  name: z.string().trim().min(2, { error: "Stop name is required" }),
  address: z.string().trim().optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const routeSchema = z.object({
  name: z.string().trim().min(2),
  code: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, { error: "Code may contain letters, digits and dashes" })
    .transform((v) => v.toUpperCase()),
  description: z.string().trim().optional(),
});

export const busSchema = z.object({
  busNumber: z.string().trim().min(2).max(20),
  registrationNo: z.string().trim().min(4).max(20),
  capacity: z.coerce.number().int().min(1).max(200),
  model: z.string().trim().optional(),
  routeId: z.string().optional().nullable(),
});

export const enrollmentSchema = z.object({
  studentId: z.string().min(1),
  busId: z.string().min(1),
  stopId: z.string().min(1),
  direction: z.enum(["PICKUP", "DROPOFF"]),
  academicYear: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, { error: "Use the format YYYY-YY, e.g. 2026-27" }),
});
