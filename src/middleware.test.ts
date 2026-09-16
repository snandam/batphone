// @vitest-environment node
import { NextRequest } from "next/server";

import { describe, expect, it } from "vitest";

import { PROTECTED_ROUTES, config, middleware } from "./middleware";

function request(pathname: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("middleware", () => {
  it.each([
    "/account",
    "/account/settings",
    "/setup",
    "/contacts",
    "/contacts/new",
    "/calls",
    "/calls/abc",
  ])(
    "redirects %s to /login with callbackUrl when there is no session cookie",
    (pathname) => {
      const response = middleware(request(pathname));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("callbackUrl")).toBe(pathname);
    }
  );

  it.each([
    "better-auth.session_token=unverified-token",
    "__Secure-better-auth.session_token=unverified-token",
  ])("passes a cookie hint through for server authentication: %s", (cookie) => {
    const response = middleware(request("/account", cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    "unrelated=value",
    "better-auth.session_token=",
    "better-auth.session_data=cached-data",
    "fake-better-auth.session_token=token",
  ])("does not treat other or empty cookies as session hints: %s", (cookie) => {
    expect(middleware(request("/calls", cookie)).status).toBe(307);
  });

  it("keeps the login callback local and omits query parameters", () => {
    const response = middleware(
      request("/calls?callbackUrl=https://example.com")
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.searchParams.get("callbackUrl")).toBe("/calls");
  });

  it.each([
    "/",
    "/login",
    "/privacy",
    "/terms",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
    "/og-image.png",
    "/.well-known/security.txt",
    "/accounts", // prefix collision must not match /account
    "/setups",
    "/callsign",
    "/no-such-page",
  ])("passes public path %s through without a cookie", (pathname) => {
    const response = middleware(request(pathname));
    expect(response.status).toBe(200);
  });

  it("keeps config.matcher in sync with PROTECTED_ROUTES", () => {
    const expected = PROTECTED_ROUTES.map((route) => `${route}/:path*`);
    expect([...config.matcher].sort()).toEqual([...expected].sort());
  });
});
