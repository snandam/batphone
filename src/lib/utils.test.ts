import { describe, expect, it } from "vitest";

import { cn, formatDate, getInitials } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("deduplicates conflicting tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns empty string for no input", () => {
    expect(cn()).toBe("");
  });
});

describe("getInitials", () => {
  it("gets two initials from full name", () => {
    expect(getInitials("Jane Doe")).toBe("JD");
  });

  it("gets one initial from single name", () => {
    expect(getInitials("Jane")).toBe("J");
  });

  it("limits to two initials for long names", () => {
    expect(getInitials("Jane Mary Doe")).toBe("JM");
  });

  it("uppercases lowercase names", () => {
    expect(getInitials("jane doe")).toBe("JD");
  });

  it("handles empty string", () => {
    expect(getInitials("")).toBe("");
  });
});

describe("formatDate", () => {
  it("formats a Date object", () => {
    // Use explicit time to avoid timezone ambiguity
    const result = formatDate(new Date("2026-01-15T12:00:00"));
    expect(result).toBe("Jan 15, 2026");
  });

  it("formats a date string", () => {
    const result = formatDate("2026-06-01T12:00:00");
    expect(result).toBe("Jun 1, 2026");
  });

  it("formats a full ISO string", () => {
    const result = formatDate("2025-12-25T10:00:00Z");
    expect(result).toContain("Dec");
    expect(result).toContain("2025");
  });

  it("treats a bare YYYY-MM-DD as a local calendar date, not UTC midnight", () => {
    // In any zone west of UTC, new Date("2026-08-01") would render Jul 31.
    expect(formatDate("2026-08-01")).toBe("Aug 1, 2026");
  });
});
