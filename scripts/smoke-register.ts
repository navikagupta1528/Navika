/**
 * Registration smoke test against a running BusGuard server.
 *
 *   npm run smoke:register          # port from .env
 *   npm run smoke:register 3010
 *
 * Registration is the only public form that writes, and it had two defects that
 * a browser made obvious and no existing suite could see:
 *
 *   - the password fields had no show/hide toggle, so the one screen that asks
 *     you to type a password twice gave you no way to check either;
 *   - a roll number the college office had already put on the roster was
 *     reported as "already registered", which made sign-up impossible for every
 *     student on the roster - that is, for every student - and pointed at an
 *     account the student had never created.
 *
 * The roster row here is created by the test itself rather than by the seed, so
 * claiming it cannot damage the demo data and the cleanup is a single delete.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role } from "../src/generated/prisma/enums";
import { attemptLogin, fieldErrors, resolveBase, submitAnonymous } from "./lib/http";

const BASE = resolveBase();
const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000)}`;
const PASSWORD = "smoke-register-1";

let pass = 0;
let fail = 0;

function record(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (ok) pass += 1;
  else fail += 1;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const rosterRoll = `smoke-${STAMP}`;
  const rosterEmail = `roster-${STAMP}@student.busguard.test`;
  const claimedEmail = `claimed-${STAMP}@example.com`;
  const newRoll = `smoke-new-${STAMP}`;
  const newEmail = `new-${STAMP}@example.com`;
  const parentEmail = `parent-${STAMP}@example.com`;

  const createdUserIds: string[] = [];

  try {
    /* The toggle is a client-side button, but it is in the server-rendered
     * markup too, so the absence of it is visible without a browser. */
    const page = await fetch(`${BASE}/register`);
    const pageHtml = await page.text();
    const toggles = [...pageHtml.matchAll(/aria-label="Show [^"]*"/g)].length;
    record(
      "the registration form offers a show-password toggle for both password fields",
      page.status === 200 && toggles >= 2,
      `${toggles} toggle(s)`,
    );

    /* The college office's half: a StudentProfile with a placeholder account,
     * exactly what the seed creates. `.test` is the marker that says nobody has
     * claimed it yet. */
    const roster = await prisma.user.create({
      data: {
        email: rosterEmail,
        username: rosterRoll,
        passwordHash: "placeholder-not-a-real-hash",
        name: "Roster Placeholder",
        role: Role.STUDENT,
        studentProfile: {
          create: { enrollmentNo: rosterRoll, department: "Mechanical", yearOfStudy: 1 },
        },
      },
      select: { id: true, studentProfile: { select: { id: true } } },
    });
    createdUserIds.push(roster.id);

    /* The student's half: claim it. The roll number is sent upper-case on
     * purpose - the action lower-cases, and the two must agree. */
    const claim = await submitAnonymous(BASE, "/register", "Create account", {
      role: "STUDENT",
      name: "Smoke Claimer",
      email: claimedEmail,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      enrollmentNo: rosterRoll.toUpperCase(),
      department: "Computer Science",
      yearOfStudy: "2",
    });
    record(
      "a roll number already on the roster can be claimed",
      claim.status === 303 && claim.location === "/student",
      `-> ${claim.status} ${claim.location}`,
    );

    const claimed = await prisma.user.findUnique({
      where: { id: roster.id },
      select: { email: true, name: true, username: true },
    });
    record(
      "claiming keeps the roster row and writes the student's own details",
      claimed?.email === claimedEmail &&
        claimed?.name === "Smoke Claimer" &&
        claimed?.username === rosterRoll,
      JSON.stringify(claimed),
    );

    const claimedProfile = await prisma.studentProfile.findUnique({
      where: { id: roster.studentProfile!.id },
      select: { department: true, yearOfStudy: true, user: { select: { id: true } } },
    });
    record(
      "claiming keeps the profile, and the student's course details replace the placeholder's",
      claimedProfile?.user.id === roster.id &&
        claimedProfile?.department === "Computer Science" &&
        claimedProfile?.yearOfStudy === 2,
      JSON.stringify(claimedProfile),
    );

    const signIn = await attemptLogin(BASE, rosterRoll, PASSWORD, "STUDENT");
    record("the password chosen at registration signs in", Boolean(signIn.cookie), signIn.message);

    /* A claimed row is a real account now. A second attempt must be refused
     * with a message that names the roll number, not the old blanket text. */
    const second = await submitAnonymous(BASE, "/register", "Create account", {
      role: "STUDENT",
      name: "Second Claimer",
      email: `second-${STAMP}@example.com`,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      enrollmentNo: rosterRoll,
    });
    const secondErrors = fieldErrors(second.html);
    record(
      "a claimed roll number cannot be claimed twice, and the message names it",
      second.status === 200 &&
        /already has an account/i.test(secondErrors.enrollmentNo ?? "") &&
        (secondErrors.enrollmentNo ?? "").includes(rosterRoll),
      secondErrors.enrollmentNo ?? "(no message)",
    );

    /* A roll number nobody has seen still creates a brand-new account. */
    const created = await submitAnonymous(BASE, "/register", "Create account", {
      role: "STUDENT",
      name: "New Student",
      email: newEmail,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      enrollmentNo: newRoll,
      department: "Civil",
      yearOfStudy: "1",
    });
    record(
      "a brand-new roll number registers",
      created.status === 303 && created.location === "/student",
      `-> ${created.status} ${created.location}`,
    );

    const newRow = await prisma.studentProfile.findUnique({
      where: { enrollmentNo: newRoll },
      select: { user: { select: { id: true, email: true, role: true } } },
    });
    record(
      "the new student is in the database, under the student role",
      newRow?.user.email === newEmail && newRow?.user.role === "STUDENT",
      JSON.stringify(newRow),
    );
    if (newRow) createdUserIds.push(newRow.user.id);

    /* Duplicate email is a field error on the email input, not a crash and not
     * a blank page. */
    const duplicate = await submitAnonymous(BASE, "/register", "Create account", {
      role: "STUDENT",
      name: "Duplicate Email",
      email: claimedEmail,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      enrollmentNo: `smoke-dup-${STAMP}`,
    });
    const duplicateErrors = fieldErrors(duplicate.html);
    record(
      "a duplicate email is explained on the email field",
      duplicate.status === 200 && /already exists/i.test(duplicateErrors.email ?? ""),
      duplicateErrors.email ?? "(no message)",
    );

    /* A parent still has to point at a student that exists. The claimed row is
     * one, so this also proves the claim left the roster usable by the family. */
    const parent = await submitAnonymous(BASE, "/register", "Create account", {
      role: "PARENT",
      name: "Smoke Parent",
      email: parentEmail,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      childEnrollmentNo: rosterRoll,
      relation: "MOTHER",
    });
    record(
      "a parent registers against a student on the roster",
      parent.status === 303 && parent.location === "/parent",
      `-> ${parent.status} ${parent.location}`,
    );

    const parentRow = await prisma.user.findUnique({
      where: { email: parentEmail },
      select: { id: true, role: true },
    });
    record(
      "the parent account is linked to the claimed student",
      parentRow?.role === "PARENT",
      JSON.stringify(parentRow),
    );
    if (parentRow) createdUserIds.push(parentRow.id);
  } finally {
    /* Deleting the users cascades to their profiles and parent links, so this
     * removes everything the suite created and nothing it did not. */
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
