import type { Field } from "@/lib/admin/fields";

/**
 * Field definitions for the admin forms.
 *
 * Collected in one file so the shape of an entity's form can be read at a
 * glance, and so the field names used by the form and by the Server Action are
 * visibly the same thing.
 */

export const stopFields: Field[] = [
  {
    kind: "text",
    name: "name",
    label: "Stop name",
    required: true,
    placeholder: "Suryanagar Chowk",
  },
  {
    kind: "text",
    name: "address",
    label: "Address",
    placeholder: "Near Aditya Circle, Kothrud",
    help: "Shown to parents so they recognise the spot.",
  },
  {
    kind: "number",
    name: "lat",
    label: "Latitude",
    required: true,
    step: "any",
    min: -90,
    max: 90,
    placeholder: "18.50740",
  },
  {
    kind: "number",
    name: "lng",
    label: "Longitude",
    required: true,
    step: "any",
    min: -180,
    max: 180,
    placeholder: "73.80770",
  },
  {
    kind: "checkbox",
    name: "isActive",
    label: "Stop is active",
    defaultChecked: true,
    help: "Inactive stops stay in history but cannot be assigned to new students.",
  },
];

export function stopDefaults(stop: {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  isActive: boolean;
}): Field[] {
  return stopFields.map((f) => {
    if (f.kind === "checkbox") return { ...f, defaultChecked: stop.isActive };
    if (f.kind !== "text" && f.kind !== "number") return f;
    const value =
      f.name === "name"
        ? stop.name
        : f.name === "address"
          ? (stop.address ?? "")
          : f.name === "lat"
            ? String(stop.lat)
            : String(stop.lng);
    return { ...f, defaultValue: value };
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const routeFields: Field[] = [
  {
    kind: "text",
    name: "name",
    label: "Route name",
    required: true,
    placeholder: "North-West Corridor",
  },
  {
    kind: "text",
    name: "code",
    label: "Code",
    required: true,
    placeholder: "NW-01",
    help: "Short unique code, used on timetables and reports.",
  },
  {
    kind: "textarea",
    name: "description",
    label: "Description",
    placeholder: "Kothrud to Shivajinagar via Paud Road",
    rows: 2,
  },
  {
    kind: "checkbox",
    name: "isActive",
    label: "Route is active",
    defaultChecked: true,
  },
];

export function routeDefaults(route: {
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
}): Field[] {
  return routeFields.map((f) => {
    if (f.kind === "checkbox") return { ...f, defaultChecked: route.isActive };
    if (f.kind !== "text" && f.kind !== "textarea") return f;
    return {
      ...f,
      defaultValue:
        f.name === "name"
          ? route.name
          : f.name === "code"
            ? route.code
            : (route.description ?? ""),
    };
  });
}

// ---------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------

export const busFields: Field[] = [
  {
    kind: "text",
    name: "busNumber",
    label: "Bus number",
    required: true,
    placeholder: "B-01",
    help: "The short code drivers and students actually use.",
  },
  {
    kind: "text",
    name: "registrationNo",
    label: "Registration number",
    required: true,
    placeholder: "MH12-AB-1000",
  },
  {
    kind: "number",
    name: "capacity",
    label: "Seating capacity",
    required: true,
    min: 1,
    max: 200,
    defaultValue: "40",
  },
  {
    kind: "text",
    name: "model",
    label: "Model",
    placeholder: "Tata Starbus",
  },
  {
    kind: "select",
    name: "routeId",
    label: "Route",
    options: [],
    emptyLabel: "No route assigned",
    help: "The route decides which stops this bus serves.",
  },
];

export function busDefaults(bus: {
  busNumber: string;
  registrationNo: string;
  capacity: number;
  model: string | null;
  routeId: string | null;
}): Field[] {
  return busFields.map((f) => {
    if (f.kind === "number") return { ...f, defaultValue: String(bus.capacity) };
    if (f.kind !== "text") return f;
    return {
      ...f,
      defaultValue:
        f.name === "busNumber"
          ? bus.busNumber
          : f.name === "registrationNo"
            ? bus.registrationNo
            : (bus.model ?? ""),
    };
  });
}

export const busStatusOptions = [
  { value: "ACTIVE", label: "Active" },
  { value: "MAINTENANCE", label: "In maintenance" },
  { value: "INACTIVE", label: "Retired" },
];

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export const driverFields: Field[] = [
  { kind: "text", name: "name", label: "Full name", required: true },
  { kind: "email", name: "email", label: "Email", required: true },
  { kind: "text", name: "phone", label: "Phone", placeholder: "9876543210" },
  {
    kind: "text",
    name: "licenseNo",
    label: "Licence number",
    required: true,
    placeholder: "MH1420190001234",
  },
  {
    kind: "date",
    name: "licenseExpiry",
    label: "Licence expiry",
    help: "Expiring licences are flagged on the drivers screen.",
  },
  {
    kind: "number",
    name: "experienceYr",
    label: "Years of experience",
    min: 0,
    max: 60,
    defaultValue: "0",
  },
  {
    kind: "password",
    name: "password",
    label: "Password",
    autoComplete: "new-password",
    help: "Leave blank when editing to keep the current password.",
  },
];

export function driverDefaults(driver: {
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  driverProfile: {
    licenseNo: string;
    licenseExpiry: Date | null;
    experienceYr: number;
  } | null;
}): Field[] {
  return driverFields.map((f) => {
    if (f.kind === "password") {
      return {
        ...f,
        help: "Leave blank to keep the current password.",
      };
    }
    if (f.kind === "number") {
      return { ...f, defaultValue: String(driver.driverProfile?.experienceYr ?? 0) };
    }
    if (f.kind === "date") {
      const d = driver.driverProfile?.licenseExpiry;
      return {
        ...f,
        defaultValue: d ? d.toISOString().slice(0, 10) : "",
      };
    }
    if (f.kind !== "text" && f.kind !== "email") return f;
    return {
      ...f,
      defaultValue:
        f.name === "name"
          ? driver.name
          : f.name === "email"
            ? driver.email
            : f.name === "phone"
              ? (driver.phone ?? "")
              : (driver.driverProfile?.licenseNo ?? ""),
    };
  });
}

/** Typed as the checkbox variant so callers can set `defaultChecked`. */
export const driverActiveField: Extract<Field, { kind: "checkbox" }> = {
  kind: "checkbox",
  name: "isActive",
  label: "Account is active",
  help: "Inactive drivers cannot sign in or be assigned to trips.",
};

// ---------------------------------------------------------------------------
// Enrolments
// ---------------------------------------------------------------------------

export const DIRECTION_OPTIONS = [
  { value: "PICKUP", label: "Home to college (pickup)" },
  { value: "DROPOFF", label: "College to home (drop-off)" },
];

export const ACADEMIC_YEARS = [
  "2026-27",
  "2025-26",
  "2024-25",
  "2023-24",
  "2022-23",
];

export function enrollmentFields(options: {
  students: { value: string; label: string }[];
  buses: { value: string; label: string }[];
  stops: { value: string; label: string }[];
}): Field[] {
  return [
    {
      kind: "select",
      name: "studentId",
      label: "Student",
      required: true,
      options: options.students,
      emptyLabel: "Select a student",
    },
    {
      kind: "select",
      name: "busId",
      label: "Bus",
      required: true,
      options: options.buses,
      emptyLabel: "Select a bus",
      help: "The stop list below must be one of this bus's stops.",
    },
    {
      kind: "select",
      name: "stopId",
      label: "Pickup stop",
      required: true,
      options: options.stops,
      emptyLabel: "Select a stop",
    },
    { kind: "select", name: "direction", label: "Direction", options: DIRECTION_OPTIONS },
    {
      kind: "text",
      name: "academicYear",
      label: "Academic year",
      required: true,
      defaultValue: ACADEMIC_YEARS[0],
      help: "Format YYYY-YY, e.g. 2026-27",
    },
  ];
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export function tripFields(options: {
  buses: { value: string; label: string }[];
  drivers: { value: string; label: string }[];
}): Field[] {
  return [
    {
      kind: "select",
      name: "busId",
      label: "Bus",
      required: true,
      options: options.buses,
      emptyLabel: "Select a bus",
    },
    {
      kind: "select",
      name: "driverId",
      label: "Driver",
      required: true,
      options: options.drivers,
      emptyLabel: "Select a driver",
    },
    { kind: "select", name: "direction", label: "Direction", options: DIRECTION_OPTIONS },
    { kind: "date", name: "date", label: "Date", required: true },
    {
      kind: "time",
      name: "scheduledStart",
      label: "Scheduled start",
      required: true,
      help: "24-hour time. The delay on the trip is measured against this.",
    },
  ];
}
