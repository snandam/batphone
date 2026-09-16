import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { isAllowedEmail, parseAllowlist } from "@/lib/allowlist";
import { logger } from "@/lib/logger";

/**
 * Better Auth Configuration
 *
 * Required environment variables:
 * - BETTER_AUTH_SECRET: Secret key for signing tokens (32+ chars)
 * - BETTER_AUTH_URL: Base URL for auth (e.g., http://localhost:3000)
 * - GOOGLE_CLIENT_ID: Google OAuth client ID
 * - GOOGLE_CLIENT_SECRET: Google OAuth client secret
 * - ALLOWED_EMAILS and/or ALLOWED_EMAIL_DOMAINS: who may sign in
 */

// Validate required environment variables
function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Optional env var with default
function getEnvVarOptional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * BETTER_AUTH_SECRET signs every session cookie. A weak or placeholder value
 * reaching production lets an attacker forge a session for any user. Fail at
 * boot in production rather than ship a forgeable secret. Dev and test are
 * unaffected; the Docker build passes a throwaway value that never runs.
 */
const PLACEHOLDER_SECRETS = [
  "replace-me",
  "change-me",
  "build-secret-not-used-at-runtime",
  "your-32-character-secret-key-here",
];

function getAuthSecret(): string {
  const secret = getEnvVar("BETTER_AUTH_SECRET");
  // `next build` runs with NODE_ENV=production and evaluates this module while
  // collecting page data, using the Dockerfile's throwaway build secret. The
  // strength check is a runtime guard, so skip it during the build phase.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuildPhase) {
    const looksLikePlaceholder = PLACEHOLDER_SECRETS.some((p) =>
      secret.toLowerCase().includes(p)
    );
    if (secret.length < 32 || looksLikePlaceholder) {
      throw new Error(
        "BETTER_AUTH_SECRET must be a strong (32+ char) non-placeholder value in production. Generate one with: openssl rand -base64 32"
      );
    }
  }
  return secret;
}

const baseURL = getEnvVarOptional("BETTER_AUTH_URL", "http://localhost:3000");

// Use secure cookies only when on HTTPS
const useSecureCookies = baseURL.startsWith("https://");

/**
 * Message the OAuth callback forwards to the login page as `?error=`.
 * Better Auth replaces spaces with underscores, so the login page matches on
 * the underscored form (see `src/app/(auth)/login/page.tsx`).
 */
export const ACCOUNT_NOT_ALLOWED_MESSAGE = "account not allowed";

export const auth = betterAuth({
  appName: getEnvVarOptional("NEXT_PUBLIC_APP_NAME", "Bat Phone"),
  baseURL,
  secret: getAuthSecret(),
  advanced: {
    // Allow cookies over HTTP in dev/non-HTTPS environments (local Docker, ALB without SSL)
    useSecureCookies,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  user: {
    additionalFields: {
      googleGivenName: { type: "string", required: false, input: false },
      googleFamilyName: { type: "string", required: false, input: false },
    },
  },
  socialProviders: {
    google: {
      clientId: getEnvVar("GOOGLE_CLIENT_ID"),
      clientSecret: getEnvVar("GOOGLE_CLIENT_SECRET"),
      // Returning users keep the name they explicitly chose during onboarding.
      overrideUserInfoOnSignIn: false,
      mapProfileToUser: (profile) => ({
        googleGivenName: profile.given_name?.trim() || null,
        googleFamilyName: profile.family_name?.trim() || null,
      }),
    },
  },
  trustedOrigins: [baseURL],
  // State validation can fail before errorCallbackURL can be recovered from
  // the OAuth state. Route those failures back to our sign-in screen too.
  onAPIError: {
    errorURL: "/login",
  },
  // nextCookies must be the last plugin. Without it, any auth.api.* call made
  // from a server action that needs to set a cookie (sign-in, sign-out,
  // session refresh) silently fails to set it.
  plugins: [nextCookies()],
  databaseHooks: {
    user: {
      create: {
        // Sign-in allowlist. Runs before the user row is written, so a
        // rejected Google account leaves nothing behind in the database.
        // The allowlist is read per call so a restart is all it takes to
        // change it. Throwing APIError (not Error) matters: the OAuth
        // callback turns an APIError into a redirect to the login page
        // with `?error=<message>`; a plain Error becomes an empty 500.
        before: async (user) => {
          const allowlist = parseAllowlist(process.env);
          if (!isAllowedEmail(user.email, allowlist)) {
            logger.warn("signin_rejected_not_allowlisted", {
              // Domain only: the address itself is personal data and the
              // operator can act on the domain alone.
              email_domain: user.email.split("@").pop() ?? "",
            });
            throw new APIError("FORBIDDEN", {
              message: ACCOUNT_NOT_ALLOWED_MESSAGE,
            });
          }
        },
        after: async (user) => {
          // Auto-create user profile on first signup
          try {
            await db
              .insert(schema.userProfile)
              .values({ userId: user.id })
              .onConflictDoNothing();
          } catch (error) {
            logger.exception("user_profile_create_failed", error);
          }
        },
      },
    },
    session: {
      create: {
        // Better Auth only runs the user hook above when it creates a user
        // row, so a returning account would otherwise never meet the
        // allowlist again. Re-checking here means removing an address locks
        // that account out at its next sign-in. A session already issued
        // stays valid until it expires.
        before: async (session) => {
          const rows = await db
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);
          const email = rows[0]?.email ?? "";
          const allowlist = parseAllowlist(process.env);
          if (!isAllowedEmail(email, allowlist)) {
            logger.warn("signin_rejected_not_allowlisted", {
              email_domain: email.split("@").pop() ?? "",
              stage: "session",
            });
            throw new APIError("FORBIDDEN", {
              message: ACCOUNT_NOT_ALLOWED_MESSAGE,
            });
          }
        },
      },
    },
  },
});
