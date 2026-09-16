import { describe, expect, it } from "vitest";

import {
  isProfileComplete,
  profileDetailsSchema,
  prefillProfileDetails,
} from "./profile";

describe("onboarding profile", () => {
  const complete = {
    firstName: "Sanjeev",
    lastName: "Nandam",
    phoneNumber: "+16045551234",
    phoneVerifiedAt: new Date(),
  };
  it("requires both explicit names and a verified phone", () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(isProfileComplete(null)).toBe(false);
    for (const field of Object.keys(complete)) {
      expect(isProfileComplete({ ...complete, [field]: null })).toBe(false);
    }
    expect(isProfileComplete({ ...complete, firstName: "  " })).toBe(false);
  });
  it("trims names and accepts international, hyphenated, and multiword names", () => {
    expect(
      profileDetailsSchema.parse({
        firstName: "  Sanjeev Kumar ",
        lastName: " O’Neill-李 ",
      })
    ).toEqual({ firstName: "Sanjeev Kumar", lastName: "O’Neill-李" });
  });
  it("rejects missing, blank, and oversized names", () => {
    for (const invalid of [null, 1, "", "  ", "a".repeat(81)]) {
      expect(
        profileDetailsSchema.safeParse({
          firstName: invalid,
          lastName: "Nandam",
        }).success
      ).toBe(false);
      expect(
        profileDetailsSchema.safeParse({
          firstName: "Sanjeev",
          lastName: invalid,
        }).success
      ).toBe(false);
    }
  });
});

describe("editable Google name suggestions", () => {
  it("preserves structured compound given and family names", () => {
    expect(
      prefillProfileDetails(
        null,
        {
          googleGivenName: " Sanjeev Kumar ",
          googleFamilyName: " van der Meer ",
        },
        "Different Display Name"
      )
    ).toEqual({ firstName: "Sanjeev Kumar", lastName: "van der Meer" });
  });
  it("keeps the user's saved choices over Google claims", () => {
    expect(
      prefillProfileDetails(
        { firstName: "Chosen", lastName: "Surname" },
        { googleGivenName: "Google", googleFamilyName: "Name" },
        "Other Display"
      )
    ).toEqual({ firstName: "Chosen", lastName: "Surname" });
  });
  it("leaves a missing structured family name blank rather than guessing", () => {
    expect(
      prefillProfileDetails(
        null,
        { googleGivenName: "Sanjeev Kumar" },
        "Sanjeev Kumar"
      )
    ).toEqual({ firstName: "Sanjeev Kumar", lastName: "" });
  });
  it("supports legacy display names as editable suggestions", () => {
    expect(
      prefillProfileDetails(null, null, "  Sanjeev  van der Meer ")
    ).toEqual({ firstName: "Sanjeev", lastName: "van der Meer" });
  });
  it("does not guess names from email addresses or absent names", () => {
    expect(prefillProfileDetails(null, null, "someone@gmail.com")).toEqual({
      firstName: "",
      lastName: "",
    });
    expect(prefillProfileDetails(null, null, " ")).toEqual({
      firstName: "",
      lastName: "",
    });
  });
});
