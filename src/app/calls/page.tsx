import type { Metadata } from "next";

import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Phone, PhoneCall, Plus } from "lucide-react";

import { listCalls } from "@/actions/calls";
import { buttonVariants } from "@/components/ui/button";
import { BAT_PHONE_NUMBER } from "@/constants";
import { auth } from "@/lib/auth";
import { formatForDisplay, toTelHref } from "@/lib/batphone/phone";
import { requireCompletedOnboarding } from "@/lib/batphone/require-profile";
import { cn } from "@/lib/utils";

import { CallListItem } from "./call-list-item";
import { isCallProcessing } from "./call-progress";
import { CallRefresh } from "./call-refresh";

export const metadata: Metadata = {
  title: "Calls",
  description: "Every call, newest first.",
};

export default async function CallsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login?callbackUrl=/calls");
  }

  await requireCompletedOnboarding(session.user.id);
  const result = await listCalls();
  if (!result.ok) {
    throw new Error(`Could not load calls: ${result.reason}`);
  }
  const { calls, timeZone } = result.data;

  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="text-primary text-xs font-semibold tracking-widest uppercase">
              Your conversations
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Calls
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Find a conversation. Pick up where you left off.
            </p>
          </div>
          {BAT_PHONE_NUMBER && (
            <a
              href={toTelHref(BAT_PHONE_NUMBER)}
              className={cn(buttonVariants(), "min-h-11 cursor-pointer gap-2")}
            >
              <Phone className="size-4" aria-hidden="true" /> Call Bat Phone
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {calls.length} {calls.length === 1 ? "call" : "calls"} · Newest
            first
          </p>
          <CallRefresh
            active={calls.some((call) => isCallProcessing(call.status))}
            watchForNewCalls
          />
        </div>

        {calls.length === 0 ? (
          <div className="bg-card flex flex-col items-center rounded-2xl border px-5 py-12 text-center sm:py-16">
            <div className="bg-primary/10 text-primary mb-5 flex size-12 items-center justify-center rounded-2xl">
              <PhoneCall className="size-6" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold">
              Your first conversation starts here
            </h2>
            <p className="text-muted-foreground mt-2 max-w-md text-sm leading-relaxed">
              Save a contact, call Bat Phone, and say their name. Your recording
              and transcript will appear here after the call.
            </p>
            <Link
              href="/contacts"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "mt-6 min-h-11 cursor-pointer gap-2"
              )}
            >
              <Plus className="size-4" aria-hidden="true" /> Add a contact
            </Link>
            {BAT_PHONE_NUMBER && (
              <p className="text-muted-foreground mt-4 text-sm">
                Bat Phone: {formatForDisplay(BAT_PHONE_NUMBER)}
              </p>
            )}
          </div>
        ) : (
          <ul
            className="bg-card divide-y overflow-hidden rounded-2xl border"
            aria-label="Call history"
          >
            {calls.map((call) => (
              <CallListItem key={call.id} call={call} timeZone={timeZone} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
