import Link from "next/link";

import { ArrowUpRight, ChevronRight } from "lucide-react";

import type { CallSummary } from "@/actions/calls";
import { callOutcome } from "@/lib/batphone/call-view";
import {
  formatDuration,
  formatE164ForDisplay,
  formatInZone,
} from "@/lib/batphone/format";
import { cn } from "@/lib/utils";

/** A conversation has one destination and one useful next action at every width. */
export function CallListItem({
  call,
  timeZone,
}: {
  call: CallSummary;
  timeZone: string;
}) {
  const outcome = callOutcome(call);
  const name =
    call.contactName ??
    (call.status === "abandoned" ? "No contact selected" : "Unknown contact");
  const startedAt = call.recordingStartedAt ?? call.inboundAt;
  const duration = call.recordingDurationSec ?? call.dialDurationSec;
  const issue =
    call.status === "transcription_failed"
      ? "Transcript couldn’t be prepared"
      : call.status === "email_failed"
        ? "Email couldn’t be sent"
        : call.status === "no_recording"
          ? "Recording unavailable"
          : null;
  const processing =
    call.status === "awaiting_recording"
      ? "Preparing recording"
      : call.status === "transcribing"
        ? "Preparing transcript"
        : null;
  const action = issue
    ? "Review call"
    : call.hasTranscript
      ? "View transcript"
      : "View call";
  const href = `/calls/${encodeURIComponent(call.id)}${call.hasTranscript && !issue ? "#transcript" : ""}`;

  return (
    <li>
      <Link
        href={href}
        className="group hover:bg-accent/40 focus-visible:ring-ring relative grid cursor-pointer gap-3 px-4 py-4 transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5 sm:px-6 sm:py-5"
      >
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-base font-semibold break-words sm:text-lg">
            {name}
          </h2>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm">
            <time dateTime={startedAt.toISOString()}>
              {formatInZone(startedAt, timeZone)}
            </time>
            {duration !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatDuration(duration)}</span>
              </>
            )}
            {call.destinationNumber && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {formatE164ForDisplay(call.destinationNumber)}
                </span>
              </>
            )}
          </p>
          {(issue || processing) && (
            <p
              className={cn(
                "text-xs sm:text-sm",
                issue ? "text-warning" : "text-muted-foreground"
              )}
            >
              {issue ?? processing}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:flex-col sm:items-end sm:justify-center">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs sm:text-sm",
              outcome.tone === "green"
                ? "text-success"
                : "text-muted-foreground"
            )}
          >
            {outcome.tone === "green" && (
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            )}
            {outcome.label}
          </span>
          <span className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 group-hover:underline">
            {action}
            <ChevronRight className="size-4" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </li>
  );
}
