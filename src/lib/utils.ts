import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get up to two uppercase initials from a name (e.g., "Jane Doe" → "JD")
 */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Format a date to a locale string with explicit locale for consistency
 */
export function formatDate(date: Date | string): string {
  return toLocalDate(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * A bare "YYYY-MM-DD" is parsed by `new Date()` as UTC midnight, so rendering
 * it in a negative-offset zone lands on the previous day (every entry showed a
 * day early across the Americas). Parse those as a local calendar date.
 * Strings carrying a time component already mean an instant, so leave them be.
 */
export function toLocalDate(date: Date | string): Date {
  if (typeof date === "string") {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (parts) {
      return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    }
  }
  return new Date(date);
}
