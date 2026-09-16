import { describe, expect, it } from "vitest";

import { formatDuration, formatE164ForDisplay, formatInZone } from "./format";

describe("formatInZone", () => {
  const instant = new Date("2026-09-11T22:42:00Z");

  it("renders the same instant differently for Los Angeles and UTC", () => {
    const la = formatInZone(instant, "America/Los_Angeles");
    const utc = formatInZone(instant, "UTC");
    expect(la).toBe("Sep 11, 2026, 3:42 PM");
    expect(utc).toBe("Sep 11, 2026, 10:42 PM");
    expect(la).not.toBe(utc);
  });

  it("rolls the calendar day in a zone east of UTC", () => {
    expect(formatInZone(instant, "Asia/Kolkata")).toBe("Sep 12, 2026, 4:12 AM");
  });

  it("falls back to UTC when the zone is not a valid IANA name", () => {
    expect(formatInZone(instant, "Not/AZone")).toBe("Sep 11, 2026, 10:42 PM");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [59, "0:59"],
    [61, "1:01"],
    [3661, "61:01"],
  ])("formats %d seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("floors fractional seconds and clamps negatives to zero", () => {
    expect(formatDuration(61.9)).toBe("1:01");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("formatE164ForDisplay", () => {
  it("renders an E.164 number in international form", () => {
    expect(formatE164ForDisplay("+14155552671")).toBe("+1 415 555 2671");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(formatE164ForDisplay("garbage")).toBe("garbage");
  });
});
