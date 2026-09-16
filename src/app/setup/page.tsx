import type { Metadata } from "next";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { BAT_PHONE_NUMBER } from "@/constants";
import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  isProfileComplete,
  prefillProfileDetails,
} from "@/lib/batphone/profile";

import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Your profile",
  description: "Bat Phone knows it's you by the number you call from.",
};

export default async function SetupPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login?callbackUrl=/setup");
  }

  const [profile] = await db
    .select({
      onboardingCompletedAt: userProfile.onboardingCompletedAt,
      firstName: userProfile.firstName,
      lastName: userProfile.lastName,
      phoneNumber: userProfile.phoneNumber,
      phoneVerifiedAt: userProfile.phoneVerifiedAt,
      timezone: userProfile.timezone,
    })
    .from(userProfile)
    .where(eq(userProfile.userId, session.user.id))
    .limit(1);

  if (isProfileComplete(profile) && !profile?.onboardingCompletedAt) {
    redirect("/setup/contact");
  }

  const verified =
    profile?.phoneNumber && profile.phoneVerifiedAt
      ? {
          phoneNumber: profile.phoneNumber,
          verifiedAt: profile.phoneVerifiedAt.toISOString(),
          timezone: profile.timezone,
        }
      : null;

  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-8 sm:space-y-12">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
          {profile?.firstName && profile?.lastName && verified
            ? "Your profile"
            : "Let’s get you ready"}
        </h1>
        <SetupForm
          initial={verified}
          initialDetails={{
            firstName: profile?.firstName ?? null,
            lastName: profile?.lastName ?? null,
          }}
          suggestedDetails={prefillProfileDetails(
            profile,
            session.user,
            session.user.name
          )}
          batPhoneNumber={BAT_PHONE_NUMBER}
        />
      </div>
    </div>
  );
}
