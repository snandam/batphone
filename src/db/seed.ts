/**
 * Database Seed Script
 *
 * Populates the database with sample data for development so the demo
 * login sees call history. Safe to run multiple times: every insert uses
 * ON CONFLICT DO NOTHING with deterministic ids.
 *
 * Usage:
 *   npm run db:seed
 *
 * Prerequisites:
 *   - DATABASE_URL set in .env.local
 *   - Schema applied first: npm run db:migrate
 *   - Optional: SEED_EMAIL set to the Google account used for the demo,
 *     so the seeded history belongs to that sign-in.
 */

import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { normalizeContactName } from "@/lib/batphone/speed-dial";
import type { StoredTranscript } from "@/lib/batphone/state";

import * as schema from "./schema";

// Load .env.local (and other .env files) the same way Next.js does.
// None of the imports above read env at import time, so this can run after them.
loadEnvConfig(process.cwd());

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Add it to .env.local or export it in your shell."
  );
  process.exit(1);
}

const SEED_EMAIL = process.env.SEED_EMAIL || "seed@example.com";

const connection = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(connection, { schema });

// Deterministic ids and SIDs for idempotent seeding.
// SIDs are deliberately non-hex so they can never collide with real Twilio ids.
const IDS = {
  user: "seed_user_regular",
  profile: "seed_profile_regular",
  contacts: {
    sanjeev: "seed_contact_sanjeev",
  },
  calls: {
    emailed: "seed_call_emailed",
    transcriptionFailed: "seed_call_transcription_failed",
    notFound: "seed_call_not_found",
    emailFailed: "seed_call_email_failed",
    busy: "seed_call_busy",
    noAnswer: "seed_call_no_answer",
    noRecording: "seed_call_no_recording",
    abandoned: "seed_call_abandoned",
    emailedShort: "seed_call_emailed_short",
  },
  attempts: {
    miss: "seed_attempt_not_found_1",
    retry: "seed_attempt_not_found_2",
  },
} as const;

const SIDS = {
  emailed: { call: "CAseed0001", dial: "CAseed0002", recording: "REseed0001" },
  transcriptionFailed: {
    call: "CAseed0003",
    dial: "CAseed0004",
    recording: "REseed0002",
  },
  notFound: { call: "CAseed0005" },
  emailFailed: {
    call: "CAseed0006",
    dial: "CAseed0007",
    recording: "REseed0003",
  },
  busy: { call: "CAseed0008", dial: "CAseed0009" },
  noAnswer: { call: "CAseed0010", dial: "CAseed0011" },
  noRecording: { call: "CAseed0012", dial: "CAseed0013" },
  abandoned: { call: "CAseed0014" },
  emailedShort: {
    call: "CAseed0015",
    dial: "CAseed0016",
    recording: "REseed0004",
  },
} as const;

/** The seed user's own verified number; the seeded contact dials it too. */
const SEED_PHONE = "+15555550142";
const SEED_CONTACT_NAME = "Mike Anderson";

const BASE = new Date("2026-09-10T15:00:00Z");
const minutesAfter = (minutes: number) =>
  new Date(BASE.getTime() + minutes * 60_000);

const SEED_TRANSCRIPT: StoredTranscript = {
  model: "nova-3",
  requestId: "seed-request-0001",
  channelConfidence: [0.97, 0.95],
  identicalChannels: false,
  utterances: [
    {
      channel: 0,
      start: 0.4,
      end: 2.1,
      text: "Hey Sanjeev, it's me. Are we still on for four?",
      confidence: 0.97,
    },
    {
      channel: 1,
      start: 2.6,
      end: 4.9,
      text: "Yes, four works. I'll bring the deck.",
      confidence: 0.95,
    },
    {
      channel: 0,
      start: 5.2,
      end: 6.0,
      text: "Perfect, see you then.",
      confidence: 0.98,
    },
  ],
};

type ContactCallSpec = {
  id: string;
  sids: { call: string; dial?: string; recording?: string };
  status: "emailed" | "email_failed" | "busy" | "no_answer" | "no_recording";
  /** Minutes relative to BASE for the inbound time. */
  startMinutes: number;
  durationSec: number | null;
  withTranscript?: boolean;
  transcriptEmail?: boolean;
  metadataEmail?: boolean;
  lastEmailError?: string;
  emailAttempts?: number;
  /** Raw Twilio AnsweredBy from answering machine detection. */
  answeredBy?: string;
  callerSpoke?: boolean;
};

/** One call to the seeded contact in the given end state, as a values() entry. */
function contactCall(spec: ContactCallSpec) {
  const start = minutesAfter(spec.startMinutes);
  const answered = spec.durationSec !== null;
  const end = minutesAfter(
    spec.startMinutes + (answered ? 1 + (spec.durationSec ?? 0) / 60 : 0.5)
  );
  const recorded = Boolean(spec.sids.recording);
  return [
    {
      id: spec.id,
      userId: IDS.user,
      contactId: IDS.contacts.sanjeev,
      contactNameSnapshot: SEED_CONTACT_NAME,
      destinationNumberSnapshot: SEED_PHONE,
      fromNumber: SEED_PHONE,
      twilioCallSid: spec.sids.call,
      dialCallSid: spec.sids.dial ?? null,
      recordingSid: spec.sids.recording ?? null,
      recordingStatus: recorded
        ? ("completed" as const)
        : answered
          ? ("absent" as const)
          : null,
      status: spec.status,
      inboundAt: start,
      endedAt: end,
      recordingStartedAt: recorded ? minutesAfter(spec.startMinutes + 1) : null,
      recordingDurationSec: recorded ? spec.durationSec : null,
      dialDurationSec: answered ? (spec.durationSec ?? 0) + 3 : null,
      transcribeAttempts: recorded ? 1 : 0,
      transcript: spec.withTranscript ? SEED_TRANSCRIPT : null,
      transcriptText: spec.withTranscript
        ? transcriptToText(SEED_TRANSCRIPT)
        : null,
      emailAttempts:
        spec.emailAttempts ??
        (spec.transcriptEmail || spec.metadataEmail ? 1 : 0),
      transcriptEmailSentAt: spec.transcriptEmail
        ? minutesAfter(spec.startMinutes + 5)
        : null,
      metadataEmailSentAt: spec.metadataEmail
        ? minutesAfter(spec.startMinutes + 5)
        : null,
      emailMessageId:
        spec.transcriptEmail || spec.metadataEmail
          ? `<${spec.id}@batphone.local>`
          : null,
      emailedTo: spec.transcriptEmail || spec.metadataEmail ? SEED_EMAIL : null,
      lastEmailError: spec.lastEmailError ?? null,
      answeredBy: spec.answeredBy ?? null,
      machineDetectionDurationMs: spec.answeredBy ? 3200 : null,
      callerSpoke: spec.callerSpoke ?? null,
      createdAt: start,
      updatedAt: end,
    },
  ];
}

function transcriptToText(transcript: StoredTranscript): string {
  return transcript.utterances
    .map((u) => `${u.channel === 0 ? "Caller" : "Contact"}: ${u.text}`)
    .join("\n");
}

async function seed() {
  console.log("Seeding database...\n");

  // 1. Users (Better Auth table)
  console.log("  Users");
  await db
    .insert(schema.user)
    .values([
      {
        id: IDS.user,
        name: SEED_CONTACT_NAME,
        email: SEED_EMAIL,
        emailVerified: true,
      },
    ])
    .onConflictDoNothing();

  // 2. Contacts, each with an explicit speed-dial code. Codes must be
  //    unique per user; the app hands out the lowest free one.
  console.log("  Contacts");
  const contactSpecs = [
    {
      id: IDS.contacts.sanjeev,
      name: SEED_CONTACT_NAME,
      phone: SEED_PHONE,
      speedDial: 1,
    },
  ];
  const contactRows = contactSpecs.map((spec) => ({
    id: spec.id,
    userId: IDS.user,
    name: spec.name,
    nameNormalized: normalizeContactName(spec.name),
    phone: spec.phone,
    speedDial: spec.speedDial,
  }));

  // 3. User profile: verified phone and timezone.
  console.log("  User profiles");
  await db
    .insert(schema.userProfile)
    .values([
      {
        id: IDS.profile,
        userId: IDS.user,
        phoneNumber: SEED_PHONE,
        phoneVerifiedAt: minutesAfter(-60),
        timezone: "America/Vancouver",
      },
    ])
    .onConflictDoNothing();

  await db.insert(schema.contact).values(contactRows).onConflictDoNothing();

  // 4. Calls: one fully emailed, one whose transcription failed after the
  //    metadata email went out, one where no contact was found, and a
  //    spread of answering machine results so the history shows Answered,
  //    and Automated answer, with different caller-speech diagnostics.
  console.log("  Calls");
  await db
    .insert(schema.call)
    .values([
      {
        id: IDS.calls.emailed,
        userId: IDS.user,
        contactId: IDS.contacts.sanjeev,
        contactNameSnapshot: SEED_CONTACT_NAME,
        destinationNumberSnapshot: SEED_PHONE,
        fromNumber: SEED_PHONE,
        twilioCallSid: SIDS.emailed.call,
        dialCallSid: SIDS.emailed.dial,
        recordingSid: SIDS.emailed.recording,
        recordingStatus: "completed",
        status: "emailed",
        transcribeAttempts: 1,
        inboundAt: minutesAfter(0),
        endedAt: minutesAfter(2),
        recordingStartedAt: minutesAfter(1),
        recordingDurationSec: 62,
        dialDurationSec: 65,
        transcript: SEED_TRANSCRIPT,
        transcriptText: transcriptToText(SEED_TRANSCRIPT),
        emailAttempts: 1,
        transcriptEmailSentAt: minutesAfter(4),
        emailMessageId: "<seed-0001@batphone.local>",
        emailedTo: SEED_EMAIL,
        answeredBy: "machine_end_beep",
        machineDetectionDurationMs: 4100,
        callerSpoke: true,
        createdAt: minutesAfter(0),
        updatedAt: minutesAfter(4),
      },
      {
        id: IDS.calls.transcriptionFailed,
        userId: IDS.user,
        contactId: IDS.contacts.sanjeev,
        contactNameSnapshot: SEED_CONTACT_NAME,
        destinationNumberSnapshot: SEED_PHONE,
        fromNumber: SEED_PHONE,
        twilioCallSid: SIDS.transcriptionFailed.call,
        dialCallSid: SIDS.transcriptionFailed.dial,
        recordingSid: SIDS.transcriptionFailed.recording,
        recordingStatus: "completed",
        status: "transcription_failed",
        lastError: "Transcription provider returned 503 after 3 attempts",
        transcribeAttempts: 3,
        inboundAt: minutesAfter(30),
        endedAt: minutesAfter(33),
        recordingStartedAt: minutesAfter(31),
        recordingDurationSec: 120,
        dialDurationSec: 123,
        emailAttempts: 1,
        metadataEmailSentAt: minutesAfter(40),
        emailMessageId: "<seed-0002@batphone.local>",
        emailedTo: SEED_EMAIL,
        answeredBy: "human",
        machineDetectionDurationMs: 1500,
        createdAt: minutesAfter(30),
        updatedAt: minutesAfter(40),
      },
      {
        id: IDS.calls.notFound,
        userId: IDS.user,
        fromNumber: SEED_PHONE,
        twilioCallSid: SIDS.notFound.call,
        status: "not_found",
        inboundAt: minutesAfter(60),
        endedAt: minutesAfter(61),
        createdAt: minutesAfter(60),
        updatedAt: minutesAfter(61),
      },
      ...contactCall({
        id: IDS.calls.emailFailed,
        sids: SIDS.emailFailed,
        status: "email_failed",
        startMinutes: -24 * 60 + 5,
        durationSec: 245,
        withTranscript: true,
        lastEmailError: "Twilio Email returned 401: invalid API key",
        emailAttempts: 2,
        answeredBy: "machine_end_beep",
        callerSpoke: false,
      }),
      ...contactCall({
        id: IDS.calls.busy,
        sids: SIDS.busy,
        status: "busy",
        startMinutes: -24 * 60 + 120,
        durationSec: null,
      }),
      ...contactCall({
        id: IDS.calls.noAnswer,
        sids: SIDS.noAnswer,
        status: "no_answer",
        startMinutes: -2 * 24 * 60 + 30,
        durationSec: null,
      }),
      ...contactCall({
        id: IDS.calls.noRecording,
        sids: SIDS.noRecording,
        status: "no_recording",
        startMinutes: -2 * 24 * 60 + 200,
        durationSec: 8,
        metadataEmail: true,
      }),
      {
        id: IDS.calls.abandoned,
        userId: IDS.user,
        fromNumber: SEED_PHONE,
        twilioCallSid: SIDS.abandoned.call,
        status: "abandoned",
        inboundAt: minutesAfter(-3 * 24 * 60),
        endedAt: minutesAfter(-3 * 24 * 60 + 0.5),
        createdAt: minutesAfter(-3 * 24 * 60),
        updatedAt: minutesAfter(-3 * 24 * 60 + 0.5),
      },
      ...contactCall({
        id: IDS.calls.emailedShort,
        sids: SIDS.emailedShort,
        status: "emailed",
        startMinutes: -3 * 24 * 60 + 90,
        durationSec: 754,
        withTranscript: true,
        transcriptEmail: true,
        answeredBy: "human",
        callerSpoke: true,
      }),
    ])
    .onConflictDoNothing();

  // 5. Resolution attempts for the not_found call: a speech miss, then a
  //    keypad retry that also misses.
  console.log("  Resolution attempts");
  await db
    .insert(schema.resolutionAttempt)
    .values([
      {
        id: IDS.attempts.miss,
        callId: IDS.calls.notFound,
        attemptNumber: 1,
        inputKind: "speech",
        heardText: "call Jonathan",
        confidence: 0.41,
        normalizedQuery: "jonathan",
        candidates: [
          {
            contactId: IDS.contacts.sanjeev,
            name: SEED_CONTACT_NAME,
            score: 0.12,
          },
        ],
        decision: "none",
        callerResponse: "retried",
        createdAt: minutesAfter(60),
        respondedAt: minutesAfter(60.25),
      },
      {
        id: IDS.attempts.retry,
        callId: IDS.calls.notFound,
        attemptNumber: 2,
        inputKind: "digits",
        heardText: "9",
        confidence: null,
        normalizedQuery: "9",
        candidates: [],
        decision: "none",
        callerResponse: "retried",
        createdAt: minutesAfter(60.5),
        respondedAt: minutesAfter(60.75),
      },
    ])
    .onConflictDoNothing();

  console.log("\nSeed complete!");
  console.log(
    `\nSeeded: 1 user (${SEED_EMAIL}), 1 profile, 1 contact, 9 calls, 2 resolution attempts`
  );
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await connection.end();
  });
