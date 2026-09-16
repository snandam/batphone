import { describe, expect, it } from "vitest";

import { postLoginDestination } from "./onboarding";

describe("postLoginDestination", () => {
  it("sends a user with no verified number to /setup", () => {
    expect(
      postLoginDestination({
        onboardingComplete: false,
        profileComplete: false,
      })
    ).toBe("/setup");
  });

  it("sends a verified user home", () => {
    expect(
      postLoginDestination({ onboardingComplete: true, profileComplete: true })
    ).toBe("/");
  });

  it("honours an explicit safe callback for a verified user", () => {
    expect(
      postLoginDestination({
        onboardingComplete: true,
        profileComplete: true,
        callbackUrl: "/calls",
      })
    ).toBe("/calls");
  });

  it("requires setup even when an explicit app callback was requested", () => {
    expect(
      postLoginDestination({
        onboardingComplete: false,
        profileComplete: false,
        callbackUrl: "/calls",
      })
    ).toBe("/setup");
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", ""])(
    "treats unsafe callback %j as absent",
    (callbackUrl) => {
      expect(
        postLoginDestination({
          onboardingComplete: false,
          profileComplete: false,
          callbackUrl,
        })
      ).toBe("/setup");
      expect(
        postLoginDestination({
          onboardingComplete: true,
          profileComplete: true,
          callbackUrl,
        })
      ).toBe("/");
    }
  );
});

it("requires the first contact before honoring a requested app page", () => {
  expect(
    postLoginDestination({
      profileComplete: true,
      onboardingComplete: false,
      callbackUrl: "/calls",
    })
  ).toBe("/setup/contact");
});
