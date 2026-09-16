import { describe, expect, it } from "vitest";

import { isAllowedEmail, parseAllowlist } from "./allowlist";

describe("isAllowedEmail", () => {
  it("accepts an exact address match", () => {
    expect(
      isAllowedEmail("alice@example.com", {
        emails: ["alice@example.com"],
        domains: [],
      })
    ).toBe(true);
  });

  it("rejects an address that is not listed", () => {
    expect(
      isAllowedEmail("mallory@example.com", {
        emails: ["alice@example.com"],
        domains: [],
      })
    ).toBe(false);
  });

  it("accepts a domain match", () => {
    expect(
      isAllowedEmail("bob@acme.com", { emails: [], domains: ["acme.com"] })
    ).toBe(true);
  });

  it("rejects a subdomain when only the apex is listed", () => {
    expect(
      isAllowedEmail("bob@mail.acme.com", {
        emails: [],
        domains: ["acme.com"],
      })
    ).toBe(false);
  });

  it("rejects a domain that merely ends with a listed apex", () => {
    expect(
      isAllowedEmail("bob@notacme.com", { emails: [], domains: ["acme.com"] })
    ).toBe(false);
  });

  it("rejects everyone when both lists are empty", () => {
    expect(
      isAllowedEmail("alice@example.com", { emails: [], domains: [] })
    ).toBe(false);
  });

  it("is case-insensitive on both sides", () => {
    expect(
      isAllowedEmail("Alice@Example.COM", {
        emails: ["ALICE@example.com"],
        domains: [],
      })
    ).toBe(true);
    expect(
      isAllowedEmail("bob@ACME.com", { emails: [], domains: ["Acme.COM"] })
    ).toBe(true);
  });

  it("ignores whitespace around entries and the candidate", () => {
    expect(
      isAllowedEmail("  alice@example.com ", {
        emails: [" alice@example.com "],
        domains: [],
      })
    ).toBe(true);
    expect(
      isAllowedEmail("bob@acme.com", { emails: [], domains: ["  acme.com "] })
    ).toBe(true);
  });

  it("ignores empty entries", () => {
    expect(
      isAllowedEmail("alice@example.com", { emails: ["", "  "], domains: [""] })
    ).toBe(false);
  });

  it("rejects a value without an @", () => {
    expect(
      isAllowedEmail("acme.com", { emails: [], domains: ["acme.com"] })
    ).toBe(false);
  });

  it("rejects an empty candidate", () => {
    expect(
      isAllowedEmail("", { emails: ["alice@example.com"], domains: [] })
    ).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("splits comma-separated env values and trims entries", () => {
    expect(
      parseAllowlist({
        ALLOWED_EMAILS: " alice@example.com, bob@example.com ,,",
        ALLOWED_EMAIL_DOMAINS: "acme.com , example.org",
      })
    ).toEqual({
      emails: ["alice@example.com", "bob@example.com"],
      domains: ["acme.com", "example.org"],
    });
  });

  it("returns empty lists when the variables are unset", () => {
    expect(parseAllowlist({})).toEqual({ emails: [], domains: [] });
  });

  it("lowercases entries", () => {
    expect(
      parseAllowlist({
        ALLOWED_EMAILS: "Alice@Example.com",
        ALLOWED_EMAIL_DOMAINS: "ACME.com",
      })
    ).toEqual({ emails: ["alice@example.com"], domains: ["acme.com"] });
  });
});
