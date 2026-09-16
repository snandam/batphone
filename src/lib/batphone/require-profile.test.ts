// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, redirect } = vi.hoisted(() => ({
  rows: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: rows }) }) }) },
}));
import {
  requireCompletedProfile,
  requireCompletedOnboarding,
} from "./require-profile";

beforeEach(() => vi.clearAllMocks());
describe("required onboarding", () => {
  it.each(
    [
      [],
      [{ firstName: "Sanjeev", lastName: "Nandam" }],
      [
        {
          firstName: null,
          lastName: null,
          phoneNumber: "+14155552671",
          phoneVerifiedAt: new Date(),
        },
      ],
      [
        {
          firstName: "Sanjeev",
          lastName: "Nandam",
          phoneNumber: "+14155552671",
          phoneVerifiedAt: null,
        },
      ],
    ].map((profileRows) => ({ profileRows }))
  )(
    "redirects incomplete profiles before app access",
    async ({ profileRows }) => {
      rows.mockResolvedValue(profileRows);
      await expect(requireCompletedProfile("user-1")).rejects.toThrow(
        "redirect:/setup"
      );
    }
  );
  it("permits a named user with verified phone", async () => {
    const profile = {
      firstName: "Sanjeev",
      lastName: "Nandam",
      phoneNumber: "+14155552671",
      phoneVerifiedAt: new Date(),
      timezone: "UTC",
    };
    rows.mockResolvedValue([profile]);
    expect(await requireCompletedProfile("user-1")).toEqual(profile);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("first contact completion gate", () => {
  const profile = {
    firstName: "Sanjeev",
    lastName: "Nandam",
    phoneNumber: "+14155552671",
    phoneVerifiedAt: new Date(),
    timezone: "UTC",
  };
  it("allows contact creation after verification but keeps the full app gated", async () => {
    rows.mockResolvedValue([{ ...profile, onboardingCompletedAt: null }]);
    await expect(requireCompletedProfile("u1")).resolves.toMatchObject(profile);
    await expect(requireCompletedOnboarding("u1")).rejects.toThrow(
      "redirect:/setup/contact"
    );
  });
  it("accepts a stored completion timestamp without rechecking contacts", async () => {
    rows.mockResolvedValue([{ ...profile, onboardingCompletedAt: new Date() }]);
    await expect(requireCompletedOnboarding("u1")).resolves.toMatchObject(
      profile
    );
    expect(rows).toHaveBeenCalledOnce();
  });
  it("requires profile completion before the contact step", async () => {
    rows.mockResolvedValue([]);
    await expect(requireCompletedOnboarding("u1")).rejects.toThrow(
      "redirect:/setup"
    );
  });
});
