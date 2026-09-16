"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { resyncCall, retryCall, type CallsFailure } from "@/actions/calls";
import { Button } from "@/components/ui/button";
import type { CallActionVisibility } from "@/lib/batphone/call-view";

interface CallActionsProps {
  callId: string;
  visibility: CallActionVisibility;
}

const FAILURE_TEXT: Record<CallsFailure, string> = {
  unauthenticated: "Your session has expired. Sign in again.",
  not_found: "This call could not be found.",
  nothing_to_retry: "There is nothing to retry for this call any more.",
  confirm_required: "Confirm that a duplicate email is acceptable first.",
  not_stuck: "This call is no longer stuck.",
  failed: "Something went wrong. Try again in a moment.",
};

const OUTCOME_TEXT: Record<string, string> = {
  emailed: "Done. The transcript email was sent.",
  transcription_failed:
    "Transcription failed again. You can try again in a moment.",
  email_failed: "The email failed again. You can try again in a moment.",
  not_claimed: "Another request is already working on this call.",
  claim_lost: "Another request took over this call.",
  resumed: "The recording was found and transcription has started.",
  dial_outcome: "Twilio reported the call did not connect.",
  recording_pending:
    "Your recording is still processing. Check again in a few minutes.",
  no_recording: "Twilio has no recording for this call.",
};

/**
 * Retry and resync buttons (R20). Retry for a possibly-sent email asks
 * for confirmation in place, since the previous attempt may already have
 * delivered the message. The page refreshes after either action so the
 * server-rendered status and header reflect the new row.
 */
export function CallActions({ callId, visibility }: CallActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  if (!visibility.retry && !visibility.resync) return null;

  const report = (result: Awaited<ReturnType<typeof retryCall>>) => {
    if (result.ok) {
      setMessage({
        text:
          OUTCOME_TEXT[result.data.outcome] ??
          `Finished with status ${result.data.outcome}.`,
        error: false,
      });
    } else {
      setMessage({ text: FAILURE_TEXT[result.reason], error: true });
    }
    router.refresh();
  };

  const runRetry = (confirmDuplicate: boolean) => {
    setConfirming(false);
    setMessage(null);
    startTransition(async () => {
      report(await retryCall(callId, { confirmDuplicate }));
    });
  };

  const runResync = () => {
    setMessage(null);
    startTransition(async () => {
      report(await resyncCall(callId));
    });
  };

  return (
    <div className="space-y-3">
      {visibility.duplicateWarning && (
        <p className="text-sm sm:text-base">
          The last attempt stopped before recording a result, so the email might
          already have been sent.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {visibility.retry &&
          (confirming ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="min-h-11 cursor-pointer"
                disabled={pending}
                onClick={() => runRetry(true)}
              >
                {pending ? "Retrying…" : "Send anyway"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 cursor-pointer"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 cursor-pointer"
              disabled={pending}
              onClick={() =>
                visibility.duplicateWarning
                  ? setConfirming(true)
                  : runRetry(false)
              }
            >
              {pending ? "Retrying…" : "Retry"}
            </Button>
          ))}

        {visibility.resync && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 cursor-pointer"
            disabled={pending}
            onClick={runResync}
          >
            {pending ? "Checking Twilio…" : "Resync with Twilio"}
          </Button>
        )}
      </div>

      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={`text-sm ${message.error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
