import type { Metadata } from "next";

import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { contact, userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireCompletedOnboarding } from "@/lib/batphone/require-profile";

import { ContactList } from "./contact-list";

export const metadata: Metadata = {
  title: "Contacts",
  description: "Say a name on the call, or key in its speed dial.",
};

export default async function ContactsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login?callbackUrl=/contacts");
  }

  const userId = session.user.id;
  await requireCompletedOnboarding(userId);
  const [contacts, [profile]] = await Promise.all([
    db
      .select({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        speedDial: contact.speedDial,
      })
      .from(contact)
      .where(eq(contact.userId, userId))
      .orderBy(asc(contact.speedDial)),
    db
      .select({
        phoneNumber: userProfile.phoneNumber,
        phoneVerifiedAt: userProfile.phoneVerifiedAt,
      })
      .from(userProfile)
      .where(eq(userProfile.userId, userId))
      .limit(1),
  ]);

  const phoneVerified = Boolean(
    profile?.phoneNumber && profile.phoneVerifiedAt
  );

  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8">
        {!phoneVerified && (
          <p className="text-sm sm:text-base">
            <Link
              href="/setup"
              className="text-primary cursor-pointer font-medium underline-offset-4 hover:underline"
            >
              Verify your number
            </Link>{" "}
            so the bat phone knows who is calling.
          </p>
        )}

        <ContactList initial={contacts} />
      </div>
    </div>
  );
}
