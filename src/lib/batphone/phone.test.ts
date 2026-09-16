import { describe, expect, it } from "vitest";

import { classifyCallerId, formatForDisplay, normalizeToE164 } from "./phone";

describe("normalizeToE164", () => {
  it("formats a national US number with the default region", () => {
    expect(normalizeToE164("(415) 555-2671", "US")).toEqual({
      ok: true,
      e164: "+14155552671",
    });
  });

  it("keeps an international number regardless of the default region", () => {
    expect(normalizeToE164("+44 20 7946 0958", "US")).toEqual({
      ok: true,
      e164: "+442079460958",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeToE164("  +1 415 555 2671 ", "US")).toEqual({
      ok: true,
      e164: "+14155552671",
    });
  });

  it.each([
    ["", "empty"],
    ["   ", "whitespace"],
    ["not a number", "letters"],
    ["123", "too short"],
    ["+1 555 123", "too short with prefix"],
    ["+1 415 555 2671 8901 2345", "too long"],
  ])("rejects %j (%s)", (input) => {
    const result = normalizeToE164(input, "US");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it("rejects a number that has the right shape but is not valid", () => {
    // The 555 exchange is fictional in the US and fails isValid() even
    // though the digit count is right.
    const result = normalizeToE164("+1 555 123 4567", "US");
    expect(result.ok).toBe(false);
  });

  it("uses the region for national input", () => {
    expect(normalizeToE164("020 7946 0958", "GB")).toEqual({
      ok: true,
      e164: "+442079460958",
    });
  });
});

describe("classifyCallerId", () => {
  it.each([
    "+266696687",
    "+7378742833",
    "anonymous",
    "Anonymous",
    "unavailable",
    "restricted",
    "",
    "   ",
  ])("returns anonymous for %j", (from) => {
    expect(classifyCallerId(from)).toBe("anonymous");
  });

  it("treats a missing value as anonymous", () => {
    expect(classifyCallerId(undefined)).toBe("anonymous");
    expect(classifyCallerId(null)).toBe("anonymous");
  });

  it.each([
    "client:alice",
    "sip:alice@example.com",
    "5551234567",
    "+1",
    "+14155552671x12",
    "+1 415 555 2671",
  ])("returns invalid for %j", (from) => {
    expect(classifyCallerId(from)).toBe("invalid");
  });

  it.each(["+14155552671", "+442079460958"])("returns e164 for %j", (from) => {
    expect(classifyCallerId(from)).toBe("e164");
  });
});

describe("formatForDisplay", () => {
  it("formats an E.164 number in international style", () => {
    expect(formatForDisplay("+14155552671")).toBe("+1 415 555 2671");
    expect(formatForDisplay("+442079460958")).toBe("+44 20 7946 0958");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(formatForDisplay("garbage")).toBe("garbage");
  });
});
