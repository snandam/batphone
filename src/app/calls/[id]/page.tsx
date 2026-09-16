import type { Metadata } from "next";

import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCall } from "@/actions/calls";
import { auth } from "@/lib/auth";
import { requireCompletedOnboarding } from "@/lib/batphone/require-profile";

import { isCallProcessing } from "../call-progress";
import { CallRefresh } from "../call-refresh";
import { CallDetail } from "./call-detail";

export const metadata: Metadata = {
  title: "Call",
  description: "The recording, the transcript, and what happened.",
};

interface CallPageProps {
  params: Promise<{ id: string }>;
}

export default async function CallPage({ params }: CallPageProps) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/calls/${id}`)}`);
  }

  await requireCompletedOnboarding(session.user.id);
  const result = await getCall(id);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    throw new Error(`Could not load the call: ${result.reason}`);
  }

  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6 sm:space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/calls"
            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 cursor-pointer items-center text-sm transition-colors"
          >
            ← All calls
          </Link>
          <CallRefresh active={isCallProcessing(result.data.call.status)} />
        </div>
        <CallDetail detail={result.data} now={new Date()} />
      </div>
    </div>
  );
}
