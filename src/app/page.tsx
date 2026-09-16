import type { Metadata } from "next";

import { headers } from "next/headers";
import Link from "next/link";

import { asc, desc, eq, sql } from "drizzle-orm";
import { ArrowRight, FileText, Mic, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BAT_PHONE_NUMBER } from "@/constants";
import { db } from "@/db/primary";
import { call } from "@/db/schema/calls";
import { contact } from "@/db/schema/contacts";
import { userProfile } from "@/db/schema/users";
import { auth } from "@/lib/auth";
import { numberLinkStatus } from "@/lib/batphone/number-link";
import { requireCompletedOnboarding } from "@/lib/batphone/require-profile";

import { HomeDashboard } from "./home-dashboard";

export const metadata: Metadata = {
  description: "Make a call. Get the transcript in your inbox.",
};

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    return (
      <div className="container mx-auto max-w-screen-2xl px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="bg-card rounded-2xl border p-6 shadow-xs sm:p-12">
            <span className="bg-accent text-primary mb-6 inline-flex size-12 items-center justify-center rounded-2xl">
              <Phone className="size-6" aria-hidden="true" />
            </span>
            <p className="text-primary mb-3 text-sm font-medium">
              Your personal calling desk
            </p>
            <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
              Make a call.
              <br />
              Keep the conversation.
            </h1>
            <p className="text-muted-foreground mt-5 max-w-lg text-base leading-relaxed sm:text-lg">
              Call your contacts from your own phone. Bat Phone records the
              conversation and sends the transcript straight to your inbox.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-7 min-h-12 w-full text-base sm:w-auto"
            >
              <Link href="/login">
                Get started with Google <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <p className="text-muted-foreground mt-3 text-xs sm:text-sm">
              Use your work account. No app to install.
            </p>
          </div>
          <ol className="mt-6 grid gap-5 sm:mt-8 sm:grid-cols-3 sm:gap-6">
            {[
              {
                icon: Phone,
                title: "One number to call",
                text: "Verify your phone and save your contacts.",
              },
              {
                icon: Mic,
                title: "Just say their name",
                text: "We’ll confirm your contact and connect you.",
              },
              {
                icon: FileText,
                title: "Every detail, saved",
                text: "Read the transcript or replay the recording.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon className="text-primary mb-3 size-5" aria-hidden="true" />
                <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  const userId = session.user.id;
  const completedProfile = await requireCompletedOnboarding(userId);
  const [[profile], [firstContact], recentCalls, numberLink] =
    await Promise.all([
      db
        .select({
          phoneNumber: userProfile.phoneNumber,
          phoneVerifiedAt: userProfile.phoneVerifiedAt,
          timezone: userProfile.timezone,
        })
        .from(userProfile)
        .where(eq(userProfile.userId, userId))
        .limit(1),
      db
        .select({
          name: contact.name,
          speedDial: contact.speedDial,
          total: sql<number>`count(*) over()`.mapWith(Number),
        })
        .from(contact)
        .where(eq(contact.userId, userId))
        .orderBy(asc(contact.speedDial))
        .limit(1),
      db
        .select({
          id: call.id,
          contactName: call.contactNameSnapshot,
          status: call.status,
          endedAt: call.endedAt,
          startedAt:
            sql<Date>`coalesce(${call.recordingStartedAt}, ${call.inboundAt})`.mapWith(
              call.inboundAt
            ),
          durationSec: sql<
            number | null
          >`coalesce(${call.recordingDurationSec}, ${call.dialDurationSec})`,
          hasTranscript: sql<boolean>`${call.transcriptText} is not null`,
          answeredBy: call.answeredBy,
          callerSpoke: call.callerSpoke,
        })
        .from(call)
        .where(eq(call.userId, userId))
        .orderBy(desc(call.inboundAt))
        .limit(3),
      numberLinkStatus(),
    ]);

  return (
    <HomeDashboard
      name={`${completedProfile.firstName} ${completedProfile.lastName}`}
      email={session.user.email}
      verifiedNumber={profile?.phoneVerifiedAt ? profile.phoneNumber : null}
      batPhoneNumber={BAT_PHONE_NUMBER}
      contactCount={firstContact?.total ?? 0}
      numberLink={numberLink.status}
      firstContact={firstContact ?? null}
      recentCalls={recentCalls}
      timeZone={profile?.timezone ?? "UTC"}
    />
  );
}
