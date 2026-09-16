// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("./calls-repo", () => ({ getCallById: vi.fn() }));
vi.mock("./pipeline", () => ({
  processRecording: vi.fn(),
  retryCall: vi.fn(),
  sendMetadataOnlyEmail: vi.fn(),
}));

import type { Call } from "@/db/schema";

import {
  executeBackgroundJob,
  isBackgroundJob,
  type BackgroundJob,
} from "./background-jobs";

const now = new Date("2026-09-16T12:00:00Z");
const job: BackgroundJob = {
  version: 1,
  kind: "process-recording",
  callId: "call-1",
};
function dependencies(patch: Partial<Call> = {}) {
  const row = {
    id: job.callId,
    status: "awaiting_recording",
    claimedAt: null,
    emailClaimedAt: null,
    recordingDurationSec: 0,
    metadataEmailSentAt: null,
    lastEmailError: null,
    ...patch,
  } as Call;
  return {
    getCallById: vi.fn().mockResolvedValue(row),
    processRecording: vi.fn().mockResolvedValue("emailed"),
    retryCall: vi.fn().mockResolvedValue("emailed"),
    sendMetadataOnlyEmail: vi.fn().mockResolvedValue("sent"),
    now: () => now,
  };
}

describe("durable job dispatch", () => {
  it("validates version, identifiers and supported jobs", () => {
    expect(isBackgroundJob(job)).toBe(true);
    for (const invalid of [
      null,
      {},
      { ...job, version: 2 },
      { ...job, callId: "" },
      { ...job, kind: "arbitrary" },
      { ...job, kind: "metadata-email" },
    ])
      expect(isBackgroundJob(invalid)).toBe(false);
  });
  it("processes a stored recording", async () => {
    const deps = dependencies();
    expect(await executeBackgroundJob(job, deps)).toEqual({
      status: "complete",
    });
    expect(deps.processRecording).toHaveBeenCalledWith(job.callId);
  });
  it("resumes an interruption between transcription and email", async () => {
    const deps = dependencies({ status: "transcribed" });
    await executeBackgroundJob(job, deps);
    expect(deps.retryCall).toHaveBeenCalledWith(job.callId);
    expect(deps.processRecording).not.toHaveBeenCalled();
  });
  it("waits for an active transcription lease", async () => {
    const deps = dependencies({ status: "transcribing", claimedAt: now });
    expect(await executeBackgroundJob(job, deps)).toEqual({
      status: "retry",
      delaySeconds: 601,
    });
    expect(deps.retryCall).not.toHaveBeenCalled();
  });
  it("reclaims interrupted stale transcription", async () => {
    const deps = dependencies({
      status: "transcribing",
      claimedAt: new Date(now.getTime() - 660_000),
    });
    await executeBackgroundJob(job, deps);
    expect(deps.retryCall).toHaveBeenCalledWith(job.callId);
  });
  it("does not automatically resend an uncertain transcript email", async () => {
    const deps = dependencies({
      status: "emailing",
      emailClaimedAt: new Date(now.getTime() - 660_000),
    });
    expect(await executeBackgroundJob(job, deps)).toEqual({
      status: "manual_review",
    });
    expect(deps.retryCall).not.toHaveBeenCalled();
  });
  it("recovers unsent failure metadata after a process interruption", async () => {
    const deps = dependencies({ status: "transcription_failed" });
    await executeBackgroundJob(job, deps);
    expect(deps.sendMetadataOnlyEmail).toHaveBeenCalledWith(
      job.callId,
      "transcription_failed"
    );
  });
  it("does not resend uncertain metadata", async () => {
    const deps = dependencies({
      status: "no_recording",
      emailClaimedAt: new Date(now.getTime() - 660_000),
    });
    expect(
      await executeBackgroundJob(
        {
          version: 1,
          kind: "metadata-email",
          callId: job.callId,
          reason: "no_recording",
        },
        deps
      )
    ).toEqual({ status: "manual_review" });
    expect(deps.sendMetadataOnlyEmail).not.toHaveBeenCalled();
  });
  it("does not repeat completed work", async () => {
    const deps = dependencies({ status: "emailed" });
    await executeBackgroundJob(job, deps);
    expect(deps.retryCall).not.toHaveBeenCalled();
    expect(deps.processRecording).not.toHaveBeenCalled();
  });
  it("propagates infrastructure failure for queue retry", async () => {
    const deps = dependencies();
    deps.getCallById.mockRejectedValue(new Error("database unavailable"));
    await expect(executeBackgroundJob(job, deps)).rejects.toThrow(
      "database unavailable"
    );
  });
});
