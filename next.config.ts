import type { NextConfig } from "next";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

const isDev = process.env.NODE_ENV === "development";

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Baseline CSP - tighten per your app's needs.
  // 'unsafe-inline' is required for Next.js style injection and inline scripts.
  // 'unsafe-eval' is only needed by the Turbopack/webpack dev runtime; the
  // production bundle does not use eval(), so it is dropped outside development
  // to keep XSS containment.
  // Any new browser-side origin (a plain-http API in dev, a third-party host)
  // must be added to connect-src or requests to it fail silently.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Standalone output for Docker deployments
  output: "standalone",

  // React Compiler for automatic optimizations
  reactCompiler: true,

  // Remove X-Powered-By header for security
  poweredByHeader: false,

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

/**
 * NEXT_PUBLIC_APP_URL is inlined into the bundle at build time and drives
 * metadataBase, the sitemap, robots, and OG URLs. A production build without
 * it once shipped a live site whose metadata pointed at http://localhost:3000.
 * Fail the build instead. Local builds get the value from .env.local.
 */
function assertPublicUrlForProductionBuild(phase: string) {
  if (phase !== PHASE_PRODUCTION_BUILD) return;
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be set for a production build (pass it as a Docker build-arg or CI env). It is baked into the bundle."
    );
  }
  if (url.includes("localhost") && process.env.CI !== "true") {
    console.warn(
      `[next.config] NEXT_PUBLIC_APP_URL is ${url}; a deployed build with a localhost origin will have broken canonical, sitemap, and OG URLs.`
    );
  }
}

export default function config(phase: string): NextConfig {
  assertPublicUrlForProductionBuild(phase);
  return nextConfig;
}
