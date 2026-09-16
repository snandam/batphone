import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CallSummary } from "@/actions/calls";

import { CallListItem } from "./call-list-item";

const TIMEZONE = "America/Los_Angeles";

function summary(overrides: Partial<CallSummary> = {}): CallSummary {
  return {
    id: "call-2",
    contactName: "Mike Anderson",
    destinationNumber: "+14155552671",
    status: "emailed",
    inboundAt: new Date("2026-09-11T21:40:00.000Z"),
    recordingStartedAt: new Date("2026-09-11T21:42:00.000Z"),
    recordingDurationSec: 42,
    dialDurationSec: 45,
    lastHeardText: null,
    hasTranscript: true,
    hasRecording: true,
    emailSentAt: new Date("2026-09-11T21:45:00.000Z"),
    emailKind: "transcript",
    answeredBy: "human",
    callerSpoke: true,
    ...overrides,
  };
}

describe("compact call history", () => {
  it("offers one accessible transcript link with call identity and timing", () => {
    render(<CallListItem call={summary()} timeZone={TIMEZONE} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/calls/call-2#transcript");
    expect(link).toHaveAccessibleName(
      expect.stringContaining("View transcript")
    );
    expect(screen.getByText("Mike Anderson")).toBeInTheDocument();
    expect(screen.getByText("Sep 11, 2026, 2:42 PM")).toBeInTheDocument();
    expect(screen.getByText("0:42")).toBeInTheDocument();
    expect(screen.getByText("+1 415 555 2671")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
    expect(
      screen.queryByText(/^(Yes|No|Transcript|Recording|Email)$/)
    ).toBeNull();
    expect(document.querySelector('a[aria-hidden="true"]')).toBeNull();
  });

  it.each([
    [true, "Automated answer"],
    [false, "Automated answer"],
  ] as const)(
    "preserves automated answer outcome for callerSpoke=%s",
    (callerSpoke, label) => {
      render(
        <CallListItem
          call={summary({ answeredBy: "machine_end_beep", callerSpoke })}
          timeZone={TIMEZONE}
        />
      );
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  );

  it.each([
    ["transcribing", "Preparing transcript"],
    ["awaiting_recording", "Preparing recording"],
  ] as const)(
    "shows progress for %s without a premature transcript link",
    (status, text) => {
      render(
        <CallListItem
          call={summary({ status, hasTranscript: false })}
          timeZone={TIMEZONE}
        />
      );
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByText("View call")).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", "/calls/call-2");
    }
  );

  it.each([
    ["transcription_failed", "Transcript couldn’t be prepared"],
    ["email_failed", "Email couldn’t be sent"],
    ["no_recording", "Recording unavailable"],
  ] as const)(
    "makes %s recoverable without jumping past the recovery controls",
    (status, text) => {
      render(<CallListItem call={summary({ status })} timeZone={TIMEZONE} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByText("Review call")).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", "/calls/call-2");
    }
  );

  it("describes a hangup before contact selection and omits missing metadata", () => {
    render(
      <CallListItem
        call={summary({
          status: "abandoned",
          contactName: null,
          destinationNumber: null,
          recordingStartedAt: null,
          recordingDurationSec: null,
          dialDurationSec: null,
          hasTranscript: false,
          hasRecording: false,
        })}
        timeZone={TIMEZONE}
      />
    );
    expect(screen.getByText("No contact selected")).toBeInTheDocument();
    expect(screen.getByText("Hung up early")).toBeInTheDocument();
    expect(screen.queryByText("Unknown contact")).toBeNull();
    expect(screen.queryByText("-")).toBeNull();
    expect(screen.getByText("Sep 11, 2026, 2:40 PM")).toBeInTheDocument();
  });
});
