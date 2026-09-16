import { NextRequest, NextResponse } from "next/server";

import { getSessionCookie } from "better-auth/cookies";

/**
 * Protected-list model: only these prefixes require a session. Everything
 * else (public pages, robots.txt, sitemap.xml, favicon, OG images,
 * .well-known, unknown paths) never reaches the auth branch, so
 * unauthenticated scrapers get the real asset or a real 404.
 *
 * If this is ever flipped to an "everything except" allowlist, the exclusion
 * list must include every asset a third party fetches without a session
 * (og-image, robots, sitemap, manifest, icons, .well-known, sw.js), and
 * unknown segments must fall through to the real 404 rather than a 307 to
 * /login. A missing entry produces no error anywhere: link previews and
 * crawlers just silently see a login page.
 *
 * `config.matcher` must stay a static literal (Next.js analyses it at build
 * time), so it duplicates this list. middleware.test.ts asserts they agree.
 */
export const PROTECTED_ROUTES = [
  "/account",
  "/setup",
  "/contacts",
  "/calls",
] as const;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  // This is only an early navigation hint, not authentication. Protected
  // pages and server actions validate the session against Better Auth before
  // reading data. Keep database/network imports out of this edge middleware.
  if (!getSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/account/:path*",
    "/setup/:path*",
    "/contacts/:path*",
    "/calls/:path*",
  ],
};
