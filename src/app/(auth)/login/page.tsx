import type { Metadata } from "next";

import { headers } from "next/headers";

import { eq } from "drizzle-orm";

import { AuthRedirect } from "@/components/auth/auth-redirect";
import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { describeSignInError } from "@/lib/auth-errors";
import { postLoginDestination } from "@/lib/batphone/onboarding";
import { isProfileComplete } from "@/lib/batphone/profile";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in with your Google account.",
};

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { callbackUrl, error } = await searchParams;

  // Check if user is already authenticated
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // Client-side redirect preserves layout (navbar) with no flicker.
  // First-time users finish onboarding before any requested app page.
  if (session) {
    const [profile] = await db
      .select({
        firstName: userProfile.firstName,
        lastName: userProfile.lastName,
        phoneNumber: userProfile.phoneNumber,
        phoneVerifiedAt: userProfile.phoneVerifiedAt,
        onboardingCompletedAt: userProfile.onboardingCompletedAt,
      })
      .from(userProfile)
      .where(eq(userProfile.userId, session.user.id))
      .limit(1);
    return (
      <AuthRedirect
        to={postLoginDestination({
          profileComplete: isProfileComplete(profile),
          onboardingComplete: Boolean(profile?.onboardingCompletedAt),
          callbackUrl,
        })}
      />
    );
  }

  return (
    <LoginForm
      callbackUrl={callbackUrl}
      initialError={describeSignInError(error)}
    />
  );
}
