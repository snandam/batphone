import Link from "next/link";

import {
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  Mail,
  Mic,
  Phone,
  PhoneCall,
  PhoneOff,
  Plus,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import {
  isCallProcessing,
  liveCallPhase,
  type LiveCallPhase,
} from "@/app/calls/call-progress";
import { CallRefresh } from "@/app/calls/call-refresh";
import { Button } from "@/components/ui/button";
import { callOutcome, processingNote } from "@/lib/batphone/call-view";
import { formatDuration, formatInZone } from "@/lib/batphone/format";
import type { NumberLinkStatus } from "@/lib/batphone/number-link";
import { formatForDisplay, toTelHref } from "@/lib/batphone/phone";
import type { CallStatus } from "@/lib/batphone/state";
import { cn } from "@/lib/utils";

export interface RecentCall {
  id: string;
  contactName: string | null;
  status: CallStatus;
  startedAt: Date;
  endedAt?: Date | null;
  durationSec: number | null;
  hasTranscript: boolean;
  answeredBy: string | null;
  callerSpoke: boolean | null;
}

export interface HomeDashboardProps {
  name: string;
  email: string;
  verifiedNumber: string | null;
  batPhoneNumber: string;
  contactCount: number;
  /** Whether Twilio's voice webhook for the number points at this app. */
  numberLink: NumberLinkStatus;
  firstContact: { name: string; speedDial: number } | null;
  recentCalls: RecentCall[];
  timeZone: string;
}

/**
 * Header badge, most urgent first: the number not reaching this app, the
 * caller's live call, a call still being processed, then setup readiness.
 * "unknown" link status falls through so a provider hiccup never alarms
 * the caller. The page's refresh control keeps it current.
 */
function LiveStatusBadge({
  phase,
  numberLink,
}: {
  phase: LiveCallPhase;
  numberLink: NumberLinkStatus;
}) {
  const shared =
    "inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium sm:text-sm";
  if (numberLink === "disconnected") {
    return (
      <span
        className={cn(shared, "bg-warning-soft text-warning")}
        role="status"
        aria-live="polite"
        title="Twilio's voice webhook for the Bat Phone number does not point at this app. Run npm run twilio:configure."
      >
        <PhoneOff className="size-4" aria-hidden="true" /> Number not connected
      </span>
    );
  }
  if (phase === "in_call") {
    return (
      <span
        className={cn(shared, "bg-primary/10 text-primary")}
        role="status"
        aria-live="polite"
      >
        <PhoneCall className="size-4" aria-hidden="true" /> Call in progress
      </span>
    );
  }
  if (phase === "processing") {
    return (
      <span
        className={cn(shared, "bg-primary/10 text-primary")}
        role="status"
        aria-live="polite"
      >
        <LoaderCircle
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />{" "}
        Processing your last call
      </span>
    );
  }
  return (
    <span
      className={cn(shared, "bg-success-soft text-success")}
      role="status"
      aria-live="polite"
    >
      <ShieldCheck className="size-4" aria-hidden="true" /> Ready to call
    </span>
  );
}

export function HomeDashboard({
  name,
  email,
  verifiedNumber,
  batPhoneNumber,
  contactCount,
  numberLink,
  firstContact,
  recentCalls,
  timeZone,
}: HomeDashboardProps) {
  const ready = Boolean(verifiedNumber && contactCount > 0);
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const livePhase = liveCallPhase(recentCalls);
  const steps = [
    {
      title: "Verify your phone",
      detail: verifiedNumber
        ? formatForDisplay(verifiedNumber)
        : "So we know it’s you when you call.",
      complete: Boolean(verifiedNumber),
      href: "/setup",
    },
    {
      title: "Save a contact",
      detail: contactCount
        ? `${contactCount} ${contactCount === 1 ? "contact" : "contacts"} ready to call`
        : "Add someone you’d like to call.",
      complete: contactCount > 0,
      href: "/contacts",
    },
    {
      title: "Make your first call",
      detail: recentCalls.length
        ? "Your call history is below."
        : "Your recording and transcript follow.",
      complete: recentCalls.length > 0,
      href: ready && batPhoneNumber ? toTelHref(batPhoneNumber) : null,
    },
  ];

  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-7 sm:space-y-9">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-full min-w-0 space-y-2">
            <p className="text-muted-foreground text-sm sm:text-base">
              Your personal calling desk
            </p>
            <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">
              Hello, {firstName}.
            </h1>
            <p className="text-muted-foreground max-w-lg text-sm leading-relaxed sm:text-base">
              {ready
                ? "A conversation now. Every detail here later."
                : "Let’s get you ready for your first call."}
            </p>
          </div>
          {ready && batPhoneNumber && (
            <LiveStatusBadge phase={livePhase} numberLink={numberLink} />
          )}
        </header>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:gap-6">
          <section
            aria-labelledby="calling-title"
            className="bg-card flex flex-col rounded-2xl border p-5 shadow-xs sm:p-8"
          >
            <div className="mb-5 flex items-center gap-3 sm:mb-6">
              <span className="bg-accent text-primary flex size-11 items-center justify-center rounded-xl">
                <Phone className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2
                  id="calling-title"
                  className="text-base font-semibold sm:text-lg"
                >
                  {ready ? "Your Bat Phone" : "One number. Every conversation."}
                </h2>
                <p className="text-muted-foreground text-xs sm:text-sm">
                  Recorded. Transcribed. In your inbox.
                </p>
              </div>
            </div>
            {ready ? (
              <>
                {batPhoneNumber ? (
                  <>
                    <p className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                      {formatForDisplay(batPhoneNumber)}
                    </p>
                    <p className="text-muted-foreground mt-3 text-sm leading-relaxed sm:text-base">
                      Call this number, then say who you’d like to reach.
                    </p>
                    <Button
                      asChild
                      size="lg"
                      className="mt-6 min-h-12 w-full text-base sm:mt-8"
                    >
                      <a href={toTelHref(batPhoneNumber)}>
                        <Phone aria-hidden="true" />
                        Call Bat Phone
                        <ArrowRight className="ml-auto" aria-hidden="true" />
                      </a>
                    </Button>
                  </>
                ) : (
                  <p
                    role="status"
                    className="bg-warning-soft text-warning rounded-xl p-4 text-sm leading-relaxed sm:p-5 sm:text-base"
                  >
                    Calling is temporarily unavailable. Your contacts and past
                    calls are still here. Please contact your administrator.
                  </p>
                )}
                <p className="text-muted-foreground mt-4 text-xs leading-relaxed sm:text-sm">
                  Call from{" "}
                  <span className="text-foreground font-medium">
                    {formatForDisplay(verifiedNumber!)}
                  </span>
                  , your verified phone.{" "}
                  <Link
                    href="/setup"
                    className="text-primary cursor-pointer underline underline-offset-4"
                  >
                    Change
                  </Link>
                </p>
              </>
            ) : (
              <>
                <h3 className="max-w-sm text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
                  Make a call.
                  <br />
                  Keep the conversation.
                </h3>
                <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed sm:text-base">
                  Use your own phone to call a saved contact. We’ll record the
                  conversation and email you the transcript.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="mt-6 min-h-12 w-full text-base sm:mt-8"
                >
                  <Link href={verifiedNumber ? "/contacts" : "/setup"}>
                    {verifiedNumber ? (
                      <Plus aria-hidden="true" />
                    ) : (
                      <ShieldCheck aria-hidden="true" />
                    )}
                    {verifiedNumber
                      ? "Add your first contact"
                      : "Verify your phone"}
                    <ArrowRight className="ml-auto" aria-hidden="true" />
                  </Link>
                </Button>
                <p className="text-muted-foreground mt-3 text-xs sm:text-sm">
                  No app to install. Just your usual phone dialer.
                </p>
              </>
            )}
          </section>

          <section
            aria-labelledby="guide-title"
            className={cn(
              "bg-card rounded-2xl border p-5 sm:p-7",
              ready && recentCalls.length > 0 && "hidden lg:block"
            )}
          >
            <h2 id="guide-title" className="text-base font-semibold sm:text-lg">
              {ready ? "From call to transcript" : "A quick setup"}
            </h2>
            {ready ? (
              <ol className="mt-5 space-y-5 sm:mt-6 sm:space-y-6">
                <li className="flex gap-3">
                  <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
                    <Mic className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium sm:text-base">
                      Say a name
                    </h3>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      Try “{firstContact?.name}”, or enter{" "}
                      <span className="text-foreground font-medium">
                        {firstContact?.speedDial}#
                      </span>{" "}
                      on the keypad.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
                    <Phone className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium sm:text-base">
                      Confirm, then talk
                    </h3>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      We’ll connect the call and record your conversation
                      automatically.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
                    <Mail className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium sm:text-base">
                      Find it in your inbox
                    </h3>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      Your transcript goes to{" "}
                      <span className="break-all">{email}</span>.
                    </p>
                  </div>
                </li>
              </ol>
            ) : (
              <ol className="mt-4 divide-y sm:mt-5">
                {steps.map((step, i) => (
                  <li key={step.title} className="flex items-center gap-3 py-4">
                    <span
                      className={
                        step.complete
                          ? "bg-success-soft text-success flex size-8 shrink-0 items-center justify-center rounded-full"
                          : "bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm"
                      }
                    >
                      {step.complete ? (
                        <Check className="size-4" aria-label="Complete" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium sm:text-base">
                        {step.href ? (
                          <Link
                            href={step.href}
                            className="cursor-pointer underline-offset-4 hover:underline"
                          >
                            {step.title}
                          </Link>
                        ) : (
                          step.title
                        )}
                      </h3>
                      <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                        {step.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section
          aria-labelledby="recent-title"
          className="space-y-3 sm:space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2
              id="recent-title"
              className="text-lg font-semibold tracking-tight sm:text-xl"
            >
              Recent calls
            </h2>
            <Link
              href="/calls"
              className="text-primary inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"
            >
              View all calls{" "}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          {recentCalls.length ? (
            <div className="bg-card overflow-hidden rounded-2xl border">
              <ul className="divide-y">
                {recentCalls.map((call) => (
                  <li key={call.id}>
                    <Link
                      href={`/calls/${encodeURIComponent(call.id)}`}
                      className="hover:bg-accent/40 focus-visible:ring-ring flex cursor-pointer items-center gap-3 p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none sm:gap-4 sm:p-5"
                    >
                      <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
                        <Phone className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold sm:text-base">
                          {call.contactName ??
                            (call.status === "abandoned"
                              ? "No contact selected"
                              : "Unknown contact")}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                          {formatInZone(call.startedAt, timeZone)}
                          {call.durationSec !== null
                            ? ` · ${formatDuration(call.durationSec)}`
                            : ""}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs sm:hidden">
                          {call.hasTranscript
                            ? "Transcript ready"
                            : (processingNote(call.status) ??
                              callOutcome(call).label)}
                        </p>
                      </div>
                      <span
                        className={
                          call.hasTranscript
                            ? "text-success hidden items-center gap-1.5 text-sm sm:inline-flex"
                            : "text-muted-foreground hidden text-sm sm:block"
                        }
                      >
                        {call.hasTranscript && (
                          <FileText className="size-4" aria-hidden="true" />
                        )}
                        {call.hasTranscript
                          ? "Transcript ready"
                          : (processingNote(call.status) ??
                            callOutcome(call).label)}
                      </span>
                      <ArrowRight
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="bg-card flex flex-col items-start gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-7">
              <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-xl">
                <FileText className="size-6" aria-hidden="true" />
              </span>
              <div className="flex-1">
                <h3 className="text-sm font-medium sm:text-base">
                  Your conversations will live here
                </h3>
                <p className="text-muted-foreground mt-1 max-w-lg text-sm leading-relaxed">
                  After your first call, come back for the recording,
                  transcript, and call details.
                </p>
              </div>
              <Link
                href="/contacts"
                className="text-primary inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"
              >
                <UsersRound className="size-4" aria-hidden="true" />
                {contactCount ? "Your contacts" : "Add a contact"}
              </Link>
            </div>
          )}
          <CallRefresh
            active={recentCalls.some((call) => isCallProcessing(call.status))}
            watchForNewCalls
          />
        </section>
        {ready && recentCalls.length > 0 && (
          <details className="bg-card rounded-2xl border p-4 sm:p-5 lg:hidden">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
              How to make a call
            </summary>
            <ol className="text-muted-foreground list-inside list-decimal space-y-3 pt-3 text-sm leading-relaxed">
              <li>Call Bat Phone from your verified number.</li>
              <li>
                Say “{firstContact?.name}”, or enter {firstContact?.speedDial}#
                on the keypad. Confirm the contact, then talk.
              </li>
              <li>
                Your call is recorded automatically. The transcript goes to{" "}
                <span className="break-all">{email}</span>.
              </li>
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
