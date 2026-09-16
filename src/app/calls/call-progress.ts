import type { CallStatus } from "@/lib/batphone/state";

/** A terminal failure needs a user action; polling cannot resolve it. */
export function isCallProcessing(status: CallStatus): boolean {
  return [
    "identifying",
    "dialing",
    "awaiting_recording",
    "transcribing",
    "transcribed",
    "emailing",
  ].includes(status);
}

/** What the caller is doing right now, judged from their most recent calls. */
export type LiveCallPhase = "in_call" | "processing" | null;

/**
 * "in_call" while any call is still on the line (choosing a contact or
 * talking), "processing" while a finished call is still becoming a
 * transcript and an email, otherwise null. A live call outranks processing.
 */
export function liveCallPhase(
  calls: readonly { status: CallStatus; endedAt?: Date | null }[]
): LiveCallPhase {
  if (
    calls.some(
      (call) =>
        !call.endedAt &&
        (call.status === "identifying" || call.status === "dialing")
    )
  ) {
    return "in_call";
  }
  if (calls.some((call) => isCallProcessing(call.status))) return "processing";
  return null;
}

export const CALL_PROGRESS_TEXT: Record<CallStatus, string> = {
  identifying: "Listening for your contact’s name.",
  dialing: "Connecting your call.",
  awaiting_recording:
    "Your recording is being prepared. The transcript will follow.",
  transcribing:
    "Turning your recording into a transcript. You can leave this page and come back.",
  transcribed: "Your transcript is ready. Preparing the email.",
  emailing: "Sending your call transcript to your inbox.",
  emailed:
    "Your call email has been sent. Review the recording and transcript below when available.",
  transcription_failed:
    "We couldn’t finish the transcript. Retry to process the recording again.",
  email_failed: "We couldn’t send the email. Retry to send it again.",
  no_recording:
    "No recording is available yet. If a delayed recording arrives, refresh this page to see it.",
  abandoned: "The call ended before a contact was connected.",
  not_found:
    "We couldn’t match a contact. Check their saved name before calling again.",
  busy: "Your contact’s line was busy. Try calling again later.",
  no_answer: "Your contact didn’t answer. Try calling again later.",
  dial_failed:
    "We couldn’t connect the call. Check the contact’s phone number and try again.",
};
