import type { CallDetailData } from "@/actions/calls";
import { Badge } from "@/components/ui/badge";
import {
  attemptLine,
  callActionVisibility,
  callHeader,
  callOutcome,
  isDryRunMessageId,
  outcomeBadgeVariant,
} from "@/lib/batphone/call-view";
import { contactSpeakerLabel } from "@/lib/batphone/email-templates";
import { formatInZone } from "@/lib/batphone/format";
import {
  speakersSeparated,
  statusBadge,
  type StoredTranscript,
} from "@/lib/batphone/state";
import { cn } from "@/lib/utils";

import { CALL_PROGRESS_TEXT } from "../call-progress";
import { CallActions } from "./call-actions";
import { RecordingPlayer } from "./recording-player";

interface CallDetailProps {
  detail: CallDetailData;
  /** Injected so the stale and stuck rules are deterministic in tests. */
  now: Date;
}

const UNKNOWN_CONTACT = "Unknown contact";
const CALLER_LABEL = "You";
const IDENTICAL_CHANNELS_NOTE =
  "Speakers could not be separated on this recording.";
const NO_SPEECH_NOTE = "No speech was detected.";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
      {children}
    </h2>
  );
}

function Transcript({
  transcript,
  farSideLabel,
}: {
  transcript: StoredTranscript;
  /** The contact's name, or "Automated system" when a machine answered. */
  farSideLabel: string;
}) {
  if (transcript.utterances.length === 0) {
    return (
      <p className="text-muted-foreground text-sm italic sm:text-base">
        {NO_SPEECH_NOTE}
      </p>
    );
  }
  if (!speakersSeparated(transcript)) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm italic sm:text-base">
          {IDENTICAL_CHANNELS_NOTE}
        </p>
        {transcript.utterances.map((u, i) => (
          <p key={i} className="text-sm sm:text-base">
            {u.text}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {transcript.utterances.map((u, i) => (
        <p key={i} className="text-sm sm:text-base">
          <span className="font-semibold">
            {u.channel === 0 ? CALLER_LABEL : farSideLabel}
          </span>
          <span className="text-muted-foreground">: </span>
          {u.text}
        </p>
      ))}
    </div>
  );
}

/** Server-rendered call result: recovery first, media next, diagnostics last. */
export function CallDetail({ detail, now }: CallDetailProps) {
  const { call, attempts, timeZone, callerName } = detail;
  const contactName =
    call.contactNameSnapshot ??
    (call.status === "abandoned" ? "No contact selected" : UNKNOWN_CONTACT);
  const outcome = callOutcome(call);
  const header = callHeader({
    callerName,
    contactName,
    destinationNumber: call.destinationNumberSnapshot ?? "",
    startedAt: call.recordingStartedAt ?? call.inboundAt,
    durationSec: call.recordingDurationSec ?? call.dialDurationSec,
    outcome: outcome.label,
    timeZone,
  });
  const visibility = callActionVisibility(call, now);
  const lastError = call.lastEmailError ?? call.lastError;
  const dryRun = isDryRunMessageId(call.emailMessageId);
  const emailSentAt = call.transcriptEmailSentAt ?? call.metadataEmailSentAt;
  const hasRecording = call.recordingSid !== null;
  const showActions = visibility.retry || visibility.resync;

  return (
    <div className="space-y-5 break-words sm:space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <h1 className="max-w-full text-3xl font-semibold tracking-tight break-words sm:text-4xl">
            {contactName}
          </h1>
          <Badge
            variant={outcomeBadgeVariant(outcome.tone)}
            className={cn(
              "text-xs sm:text-sm",
              outcome.tone === "green" &&
                "bg-success-soft text-success border-success/15"
            )}
          >
            {outcome.label}
          </Badge>
        </div>
        {header[3] && (
          <p className="text-muted-foreground text-base sm:text-lg">
            {header[3][1]}
          </p>
        )}
      </div>

      <section
        className="bg-card space-y-3 rounded-2xl border p-4 sm:p-6"
        aria-label="Call status"
      >
        <h2 className="text-base font-semibold">{statusBadge(call.status)}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {CALL_PROGRESS_TEXT[call.status]}
        </p>
        {dryRun && (
          <p className="text-muted-foreground text-sm">
            Email dry run: the email was logged instead of sent.
          </p>
        )}
        {showActions && (
          <CallActions callId={call.id} visibility={visibility} />
        )}
      </section>

      {hasRecording && (
        <section className="bg-card space-y-4 rounded-2xl border p-4 sm:p-6">
          <SectionTitle>Recording</SectionTitle>
          <RecordingPlayer callId={call.id} />
        </section>
      )}

      {call.transcript && (
        <section
          id="transcript"
          className="bg-card space-y-4 rounded-2xl border p-4 sm:p-6"
        >
          <SectionTitle>Transcript</SectionTitle>
          <Transcript
            transcript={call.transcript}
            farSideLabel={contactSpeakerLabel(contactName, call.answeredBy)}
          />
        </section>
      )}

      <section className="bg-card space-y-4 rounded-2xl border p-4 sm:p-6">
        <SectionTitle>Details</SectionTitle>
        <dl className="divide-border divide-y text-sm sm:text-base">
          {header.map(([label, value]) => (
            <div
              key={label}
              className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
            <dt className="text-muted-foreground">Email delivery</dt>
            <dd className="max-w-full text-right break-words">
              {dryRun ? (
                "Not sent (test mode)"
              ) : emailSentAt ? (
                <>
                  <span className="block">
                    {call.transcriptEmailSentAt
                      ? "Transcript sent"
                      : "Call details sent"}
                    {call.emailedTo ? ` to ${call.emailedTo}` : ""}
                  </span>
                  <span className="text-muted-foreground text-xs sm:text-sm">
                    {formatInZone(emailSentAt, timeZone)}
                  </span>
                </>
              ) : (
                "Delivery not confirmed"
              )}
            </dd>
          </div>
        </dl>
      </section>

      {(lastError || attempts.length > 0) && (
        <details className="bg-card rounded-2xl border p-4 sm:p-6">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
            Call diagnostics
          </summary>
          <div className="space-y-5 pt-4">
            {lastError && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold">Technical error</h2>
                <p className="text-muted-foreground text-sm break-words">
                  {lastError}
                </p>
              </div>
            )}
            {attempts.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">
                  How the bat phone understood you
                </h2>
                <ol className="space-y-2 text-sm">
                  {attempts.map((attempt) => (
                    <li key={attempt.id}>{attemptLine(attempt)}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
