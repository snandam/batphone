import type { Metadata } from "next";

import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { formatForDisplay } from "@/lib/batphone/phone";
import { requireCompletedOnboarding } from "@/lib/batphone/require-profile";

export const metadata: Metadata = {
  title: "Account",
  description: "Your details and verified mobile number.",
};

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  const completedProfile = await requireCompletedOnboarding(session.user.id);
  const [profile] = await db
    .select({
      phoneNumber: userProfile.phoneNumber,
      phoneVerifiedAt: userProfile.phoneVerifiedAt,
    })
    .from(userProfile)
    .where(eq(userProfile.userId, session.user.id))
    .limit(1);
  const verifiedNumber =
    profile?.phoneNumber && profile.phoneVerifiedAt
      ? formatForDisplay(profile.phoneNumber)
      : null;

  const rows: Array<[string, React.ReactNode]> = [
    ["Name", `${completedProfile.firstName} ${completedProfile.lastName}`],
    ["Email", session.user.email],
    [
      "Number",
      verifiedNumber ?? (
        <span className="text-muted-foreground">Not verified</span>
      ),
    ],
  ];

  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-8 sm:space-y-12">
        <div className="space-y-3 sm:space-y-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Account
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg">
            Your details and verified mobile number.
          </p>
        </div>

        <dl className="divide-border divide-y border-y text-sm sm:text-base">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>

        <Link
          href="/setup"
          className="text-primary inline-block cursor-pointer text-sm font-medium underline-offset-4 hover:underline sm:text-base"
        >
          {verifiedNumber ? "Change your number" : "Verify your number"}
        </Link>
      </div>
    </div>
  );
}
