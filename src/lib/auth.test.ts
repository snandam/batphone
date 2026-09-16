// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ betterAuth: vi.fn((options) => options) }));
vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("@/db", () => ({ db: {} }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
});

describe("Google onboarding name claims", () => {
  it("captures structured names without assigning canonical onboarding details", async () => {
    await import("./auth");
    const options = mocks.betterAuth.mock.calls.at(-1)?.[0];
    expect(
      options.socialProviders.google.mapProfileToUser({
        given_name: " Sanjeev Kumar ",
        family_name: " van der Meer ",
      })
    ).toEqual({
      googleGivenName: "Sanjeev Kumar",
      googleFamilyName: "van der Meer",
    });
    expect(options.socialProviders.google.mapProfileToUser({})).toEqual({
      googleGivenName: null,
      googleFamilyName: null,
    });
  });
  it("keeps claims read-only for clients and preserves chosen name on later sign-ins", async () => {
    await import("./auth");
    const options = mocks.betterAuth.mock.calls.at(-1)?.[0];
    expect(options.user.additionalFields.googleGivenName).toEqual({
      type: "string",
      required: false,
      input: false,
    });
    expect(options.user.additionalFields.googleFamilyName).toEqual({
      type: "string",
      required: false,
      input: false,
    });
    expect(options.socialProviders.google.overrideUserInfoOnSignIn).toBe(false);
  });
});

describe("sign-in allowlist", () => {
  function allowlistDb(email: string | null) {
    const limit = vi.fn(async () => (email === null ? [] : [{ email }]));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    return { select, where };
  }

  it("rejects account creation for an address outside the allowlist", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "kept@example.com");
    await import("./auth");
    const options = mocks.betterAuth.mock.calls.at(-1)?.[0];
    await expect(
      options.databaseHooks.user.create.before({ email: "gone@example.com" })
    ).rejects.toMatchObject({ message: "account not allowed" });
    await expect(
      options.databaseHooks.user.create.before({ email: "kept@example.com" })
    ).resolves.toBeUndefined();
  });

  it("re-checks the allowlist before every session so removal blocks the next sign-in", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "kept@example.com");
    const fake = allowlistDb("gone@example.com");
    vi.doMock("@/db", () => ({ db: fake }));
    await import("./auth");
    const options = mocks.betterAuth.mock.calls.at(-1)?.[0];
    await expect(
      options.databaseHooks.session.create.before({ userId: "user-1" })
    ).rejects.toMatchObject({ message: "account not allowed" });
    expect(fake.where).toHaveBeenCalled();
  });

  it("lets a still-allowed user create a session and rejects an unknown user id", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "kept@example.com");
    vi.doMock("@/db", () => ({ db: allowlistDb("kept@example.com") }));
    await import("./auth");
    let options = mocks.betterAuth.mock.calls.at(-1)?.[0];
    await expect(
      options.databaseHooks.session.create.before({ userId: "user-1" })
    ).resolves.toBeUndefined();

    vi.resetModules();
    vi.doMock("@/db", () => ({ db: allowlistDb(null) }));
    await import("./auth");
    options = mocks.betterAuth.mock.calls.at(-1)?.[0];
    await expect(
      options.databaseHooks.session.create.before({ userId: "missing" })
    ).rejects.toMatchObject({ message: "account not allowed" });
  });
});
