/**
 * Navika demo seed.
 *
 * Produces a believable small college: 3 routes, 12 stops, 5 buses, 6 drivers,
 * 40 students, 8 parents, live enrolments and a couple of trips in progress.
 *
 *   npm run seed
 *
 * The coordinates are around Pune, Maharashtra. Swap them for your own campus
 * when demoing elsewhere.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import {
  AlertType,
  BusStatus,
  Direction,
  PickupStatus,
  Role,
  TripDirection,
  TripStatus,
} from "../src/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in, " +
      "or run: npm run setup:db",
  );
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PUNE = { lat: 18.5204, lng: 73.8567 };

/** Nudge a coordinate by roughly `dLat`/`dLng` degrees. */
function at(dLat: number, dLng: number) {
  return { lat: PUNE.lat + dLat, lng: PUNE.lng + dLng };
}

const STOP_SEED = [
  { name: "Kothrud Bus Depot", address: "Kothrud, Pune", ...at(0.021, -0.028) },
  { name: "Suryanagar Chowk", address: "Suryanagar, Pune", ...at(0.018, -0.016) },
  { name: "Pashan Sus Road", address: "Pashan, Pune", ...at(0.014, -0.006) },
  { name: "Baner Road Signal", address: "Baner, Pune", ...at(0.009, 0.011) },
  { name: "Balewadi Stadium", address: "Balewadi, Pune", ...at(0.005, 0.027) },
  { name: "Aundh IT Park", address: "Aundh, Pune", ...at(0.002, 0.038) },
  { name: "University Gate", address: "University Road, Pune", ...at(-0.002, 0.047) },
  { name: "Deccan Gymkhana", address: "Deccan, Pune", ...at(-0.006, 0.052) },
  { name: "Shivajinagar Bus Stop", address: "Shivajinagar, Pune", ...at(-0.011, 0.045) },
  { name: "Hadapsar Bridge", address: "Hadapsar, Pune", ...at(-0.014, 0.033) },
  { name: "Koregaon Park", address: "Koregaon Park, Pune", ...at(-0.009, 0.018) },
  { name: "Viman Nagar Junction", address: "Viman Nagar, Pune", ...at(-0.003, 0.004) },
];

const ROUTE_SEED = [
  {
    name: "North-West Corridor",
    code: "NW-1",
    description: "Kothrud to University via Baner road",
    stopNames: [
      "Kothrud Bus Depot",
      "Suryanagar Chowk",
      "Pashan Sus Road",
      "Baner Road Signal",
      "Balewadi Stadium",
      "Aundh IT Park",
      "University Gate",
    ],
    schedule: ["07:00", "07:10", "07:20", "07:30", "07:40", "07:48", "08:00"],
  },
  {
    name: "South-East Link",
    code: "SE-2",
    description: "Kothrud to Viman Nagar via core city",
    stopNames: [
      "Kothrud Bus Depot",
      "Pashan Sus Road",
      "Koregaon Park",
      "Deccan Gymkhana",
      "Shivajinagar Bus Stop",
      "Viman Nagar Junction",
    ],
    schedule: ["07:15", "07:28", "07:42", "07:52", "08:00", "08:14"],
  },
  {
    name: "Hadapsar Express",
    code: "HX-3",
    description: "Kothrud to Hadapsar via Shivajinagar",
    stopNames: [
      "Kothrud Bus Depot",
      "Suryanagar Chowk",
      "Koregaon Park",
      "Shivajinagar Bus Stop",
      "Hadapsar Bridge",
    ],
    schedule: ["07:05", "07:16", "07:30", "07:40", "07:55"],
  },
];

const DEPARTMENTS = [
  "Computer Science",
  "Electronics & Communication",
  "Mechanical Engineering",
  "Civil Engineering",
  "Information Technology",
];

const FIRST_NAMES = [
  "Aarav", "Ananya", "Ishaan", "Diya", "Kabir", "Meera", "Rohan", "Saanvi",
  "Arjun", "Ishita", "Vihaan", "Aditi", "Rahul", "Priya", "Karan", "Neha",
  "Aditya", "Pooja", "Siddharth", "Kavya", "Nikhil", "Riya", "Manav", "Tanvi",
  "Yash", "Sneha", "Devansh", "Anjali", "Omkar", "Shreya",
];

const LAST_NAMES = [
  "Sharma", "Patil", "Deshmukh", "Kulkarni", "Joshi", "Mehta", "Pawar",
  "Chavan", "Gaikwad", "Rane",
];

const SCHOOL_YEAR = "2026-27";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log("Seeding Navika…\n");

  // Clear in dependency order so re-running is safe.
  await prisma.notification.deleteMany();
  await prisma.emergencyAlert.deleteMany();
  await prisma.pickupRecord.deleteMany();
  await prisma.stopEvent.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.etaCache.deleteMany();
  await prisma.busDriver.deleteMany();
  await prisma.parentChild.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.parentProfile.deleteMany();
  await prisma.driverProfile.deleteMany();
  await prisma.routeStop.deleteMany();
  await prisma.route.deleteMany();
  await prisma.stop.deleteMany();
  await prisma.bus.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("navika123", 10);
  console.log("  · wiped existing data");

  // ---------------------------------------------------------------- stops
  const stopByName = new Map<string, { id: string; lat: number; lng: number; name: string }>();
  for (const s of STOP_SEED) {
    const created = await prisma.stop.create({
      data: { name: s.name, address: s.address, lat: s.lat, lng: s.lng },
      select: { id: true, name: true, lat: true, lng: true },
    });
    stopByName.set(created.name, created);
  }
  console.log(`  · ${STOP_SEED.length} stops`);

  // --------------------------------------------------------------- routes
  const routes = [];
  for (const r of ROUTE_SEED) {
    const route = await prisma.route.create({
      data: {
        name: r.name,
        code: r.code,
        description: r.description,
      },
    });
    for (const [i, name] of r.stopNames.entries()) {
      const stop = stopByName.get(name)!;
      await prisma.routeStop.create({
        data: {
          routeId: route.id,
          stopId: stop.id,
          stopOrder: i + 1,
          scheduledHHMM: r.schedule[i] ?? null,
        },
      });
    }
    routes.push({ ...route, stopNames: r.stopNames, stopIds: r.stopNames.map((n) => stopByName.get(n)!.id) });
  }
  console.log(`  · ${routes.length} routes`);

  // ---------------------------------------------------------------- admin
  const admin = await prisma.user.create({
    data: {
      email: "admin@navika.test",
      passwordHash,
      name: "Anita Deshpande",
      phone: "+91 98220 11001",
      role: Role.ADMIN,
    },
  });
  console.log("  · admin@navika.test / navika123");

  // -------------------------------------------------------------- drivers
  const driverUsers = [];
  for (let i = 0; i < 6; i++) {
    const name = `${FIRST_NAMES[i * 3]} ${LAST_NAMES[i]}`;
    const user = await prisma.user.create({
      data: {
        email: `driver${i + 1}@navika.test`,
        passwordHash,
        name,
        phone: `+91 98220 2${1000 + i}`,
        role: Role.DRIVER,
        driverProfile: {
          create: {
            licenseNo: `MH-2019-${4000 + i}`,
            licenseExpiry: new Date("2029-06-30"),
            experienceYr: 3 + i,
          },
        },
      },
    });
    driverUsers.push(user);
  }
  console.log(`  · ${driverUsers.length} drivers (driver1@navika.test / navika123)`);

  // ----------------------------------------------------------------- buses
  const buses = [];
  for (let i = 0; i < 5; i++) {
    const bus = await prisma.bus.create({
      data: {
        busNumber: `NB-${101 + i}`,
        registrationNo: `MH12-AB-${1000 + i}`,
        capacity: 40,
        model: i < 2 ? "Tata Starbus" : "Ashok Leyland Viking",
        status: BusStatus.ACTIVE,
        routeId: routes[i % routes.length].id,
      },
    });
    buses.push(bus);

    // primary driver, plus a relief driver
    await prisma.busDriver.create({
      data: { busId: bus.id, driverId: driverUsers[i].id, isPrimary: true },
    });
    if (i + 1 < driverUsers.length) {
      await prisma.busDriver.create({
        data: {
          busId: bus.id,
          driverId: driverUsers[i + 1].id,
          isPrimary: false,
        },
      });
    }
  }
  console.log(`  · ${buses.length} buses`);

  // -------------------------------------------------------------- students
  const usedEnrollment = new Set<string>();
  const students = [];
  for (let i = 0; i < 40; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 3) % LAST_NAMES.length];
    const name = `${first} ${last}`;
    const enrollmentNo = `CSE${2026}-${String(140 + i).padStart(4, "0")}`;

    if (usedEnrollment.has(enrollmentNo)) continue;
    usedEnrollment.add(enrollmentNo);

    const user = await prisma.user.create({
      data: {
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@student.navika.test`,
        passwordHash,
        name,
        phone: `+91 90040 ${10000 + i}`,
        role: Role.STUDENT,
        studentProfile: {
          create: {
            enrollmentNo,
            department: pick(DEPARTMENTS),
            yearOfStudy: (i % 4) + 1,
            guardianName: `${first === "Aditi" ? "Sunil" : "Ramesh"} ${last}`,
          },
        },
      },
      include: { studentProfile: true },
    });
    students.push(user);
  }
  console.log(`  · ${students.length} students`);

  // -------------------------------------------------------------- parents
  const parents = [];
  for (let i = 0; i < 8; i++) {
    const student = students[i * 2];
    if (!student?.studentProfile) continue;
    const parentName = `${i % 2 === 0 ? "Sunita" : "Mahesh"} ${student.name.split(" ")[1]}`;
    const user = await prisma.user.create({
      data: {
        email: `parent${i + 1}@navika.test`,
        passwordHash,
        name: parentName,
        phone: `+91 90050 ${20000 + i}`,
        role: Role.PARENT,
        parentProfile: {
          create: {
            relation: i % 2 === 0 ? "MOTHER" : "FATHER",
            children: { create: [{ studentId: student.studentProfile!.id }] },
          },
        },
      },
    });
    parents.push(user);
  }
  console.log(`  · ${parents.length} parents (parent1@navika.test / navika123)`);

  // ----------------------------------------------------------- enrolments
  let enrolmentCount = 0;
  for (const [i, student] of students.entries()) {
    const bus = buses[i % buses.length];
    const route = routes.find((r) => r.id === bus.routeId)!;
    // spread students across the route's non-final stops
    const pickable = route.stopIds.slice(1, Math.max(2, route.stopIds.length - 1));
    const stopId = pickable[i % pickable.length];

    await prisma.enrollment.create({
      data: {
        studentId: student.studentProfile!.id,
        busId: bus.id,
        stopId,
        direction: i % 3 === 0 ? Direction.PICKUP : Direction.DROPOFF,
        academicYear: SCHOOL_YEAR,
      },
    });
    enrolmentCount++;
  }
  console.log(`  · ${enrolmentCount} enrolments`);

  // ------------------------------------------------------------ live trips
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 2; i++) {
    const bus = buses[i];
    const route = routes.find((r) => r.id === bus.routeId)!;
    const driver = driverUsers[i];
    const startedAt = new Date(Date.now() - (12 + i * 6) * 60 * 1000);

    const trip = await prisma.trip.create({
      data: {
        busId: bus.id,
        routeId: route.id,
        driverId: driver.id,
        date: today,
        direction: TripDirection.PICKUP,
        status: TripStatus.ONGOING,
        scheduledStart: new Date(today.getTime() + (7 + i * 0.25) * 3600 * 1000),
        startedAt,
        stopEvents: {
          create: route.stopIds.slice(0, 2).map((stopId, idx) => ({
            stopId,
            arrivedAt: new Date(startedAt.getTime() + idx * 9 * 60 * 1000),
            departedAt: new Date(startedAt.getTime() + (idx * 9 + 2) * 60 * 1000),
            delaySeconds: idx * 90,
          })),
        },
      },
    });

    // one pickup row per enrolled student on this bus, mostly still pending
    const enrolments = await prisma.enrollment.findMany({
      where: { busId: bus.id, direction: Direction.PICKUP },
      include: { student: { include: { user: true } } },
    });

    for (const [idx, e] of enrolments.entries()) {
      const firstTwoStops = route.stopIds.slice(0, 2);
      const isPast = firstTwoStops.includes(e.stopId);

      await prisma.pickupRecord.create({
        data: {
          tripId: trip.id,
          studentId: e.studentId,
          stopId: e.stopId,
          enrollmentId: e.id,
          status: isPast
            ? PickupStatus.PICKED
            : idx % 3 === 0
              ? PickupStatus.WAITING
              : PickupStatus.PENDING,
          waitingMarkedAt: isPast || idx % 3 === 0 ? new Date() : null,
          pickedAt: isPast ? new Date(startedAt.getTime() + 10 * 60 * 1000) : null,
        },
      });
    }

    // put the bus somewhere plausible on the route
    const liveStops = route.stopIds
      .map((id) => STOP_SEED.find((s) => stopByName.get(s.name)?.id === id)!)
      .filter(Boolean);
    const atIdx = Math.min(1, liveStops.length - 1);
    const here = liveStops[atIdx];
    const next = liveStops[atIdx + 1] ?? here;

    await prisma.bus.update({
      where: { id: bus.id },
      data: {
        currentLat: (here.lat + next.lat) / 2,
        currentLng: (here.lng + next.lng) / 2,
        speedKph: 28 + i * 4,
        headingDeg: 45,
        lastLocationAt: new Date(),
        onboardCount: 12 + i * 3,
      },
    });
  }
  console.log("  · 2 live trips with pickup records");

  // --------------------------------------------------------------- alert
  await prisma.emergencyAlert.create({
    data: {
      busId: buses[0].id,
      raisedById: driverUsers[0].id,
      type: AlertType.DELAY,
      message: "Heavy traffic near Baner road signal, running about 10 minutes late.",
      lat: buses[0].currentLat,
      lng: buses[0].currentLng,
    },
  });
  console.log("  · 1 open alert");

  console.log("\nDemo accounts (password for all: navika123)");
  console.log("  admin   admin@navika.test");
  console.log("  driver  driver1@navika.test");
  console.log("  parent  parent1@navika.test");
  console.log("  student aarav.sharma0@student.navika.test");
  console.log(`\n  ${admin.name} (admin id ${admin.id})`);
  console.log("");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("\nSeed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
