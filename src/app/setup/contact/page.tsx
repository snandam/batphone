import type { Metadata } from "next";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { contact } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireCompletedProfile } from "@/lib/batphone/require-profile";

import { FirstContactForm } from "./first-contact-form";

export const metadata: Metadata = {
  title: "Add your first contact",
  description: "Save someone to call with Bat Phone.",
};

export default async function FirstContactPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login?callbackUrl=/setup/contact");
  const profile = await requireCompletedProfile(session.user.id);
  if (profile.onboardingCompletedAt) redirect("/");
  const contacts = await db
    .select({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      speedDial: contact.speedDial,
    })
    .from(contact)
    .where(eq(contact.userId, session.user.id))
    .orderBy(asc(contact.speedDial));

  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6 sm:space-y-8">
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">Step 2 of 2</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Add your first contact
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Save someone you’d like to call. You can add more contacts later.
          </p>
        </div>
        <FirstContactForm contacts={contacts} />
      </div>
    </div>
  );
}
