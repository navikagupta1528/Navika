import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatDate(d);
}

/** Human ETA label, e.g. "7 min", "at stop", "arriving". */
export function etaLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes <= 0) return "at your stop";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

/**
 * How old a bus position may be before we stop calling the bus "live". A
 * phone in a basement loses GPS for a while, so a couple of missed pings must
 * not be read as "the bus is parked here".
 */
export const LIVE_WINDOW_MS = 2 * 60 * 1000;

export function isStale(
  timestamp: Date | string | null | undefined,
  maxAgeMs: number = LIVE_WINDOW_MS,
): boolean {
  if (!timestamp) return true;
  const at =
    typeof timestamp === "string" ? Date.parse(timestamp) : timestamp.getTime();
  if (Number.isNaN(at)) return true;
  return Date.now() - at > maxAgeMs;
}
