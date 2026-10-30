import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth-password";
import { Role } from "../src/generated/prisma/enums";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function makeRollNo(year: string, dept: string, num: number) {
  const n = String(num).padStart(2, "0");
  return `${year}${dept.toLowerCase()}${n}`;
}

async function main() {
  const year = process.env.CLASS_YEAR || "25";
  const dept = process.env.CLASS_DEPT || "cse";
  const start = Number(process.env.START || "1");
  const end = Number(process.env.END || "65");
  const defaultPass = process.env.DEFAULT_PASS || "123456";

  const passHash = await hashPassword(defaultPass);

  for (let i = start; i <= end; i++) {
    const roll = makeRollNo(year, dept, i);
    const parentRoll = roll + "p";
    const email = `${roll}@student.busguard.test`;
    const parentEmail = `${parentRoll}@parent.busguard.test`;

    const user = await prisma.user.upsert({
      where: { email },
      update: { username: roll, mustChangePassword: true },
      create: {
        email,
        username: roll,
        name: `Student ${roll.toUpperCase()}`,
        passwordHash: passHash,
        role: Role.STUDENT,
        mustChangePassword: true,
      },
    });

    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: { enrollmentNo: roll.toUpperCase() },
      create: {
        userId: user.id,
        enrollmentNo: roll.toUpperCase(),
        department: dept.toUpperCase(),
        yearOfStudy: 1,
      },
    });

    const parent = await prisma.user.upsert({
      where: { email: parentEmail },
      update: { username: parentRoll, mustChangePassword: true },
      create: {
        email: parentEmail,
        username: parentRoll,
        name: `Parent of ${roll.toUpperCase()}`,
        passwordHash: passHash,
        role: Role.PARENT,
        mustChangePassword: true,
      },
    });

    const studentProfile = await prisma.studentProfile.findUnique({
      where: { enrollmentNo: roll.toUpperCase() },
    });

    if (studentProfile) {
      const parentProfile = await prisma.parentProfile.upsert({
        where: { userId: parent.id },
        update: { relation: "GUARDIAN" },
        create: { userId: parent.id, relation: "GUARDIAN" },
      });
      await prisma.parentChild.upsert({
        where: {
          parentId_studentId: {
            parentId: parentProfile.id,
            studentId: studentProfile.id,
          },
        },
        update: {},
        create: {
          parentId: parentProfile.id,
          studentId: studentProfile.id,
        },
      });
    }

    console.log(`created ${roll} / ${parentRoll}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
