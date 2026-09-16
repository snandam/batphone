import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type {
  CallStatus,
  RecordingStatus,
  StoredTranscript,
} from "@/lib/batphone/state";

import { user } from "./auth";
import { contact } from "./contacts";

/**
 * Call Table
 *
 * One row per inbound call to the bat phone, created by the inbound
 * webhook once the caller's number matches a verified profile. Carries the
 * pipeline status (see src/lib/batphone/state.ts), the claim columns that
 * make each step idempotent, and snapshots of the contact so history stays
 * readable after a contact is edited or deleted.
 *
 * status is text typed to the CallStatus union rather than a pgEnum so the
 * vocabulary can change without an enum migration.
 */
export const call = pgTable(
  "call",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    contactNameSnapshot: text("contact_name_snapshot"),
    destinationNumberSnapshot: text("destination_number_snapshot"),
    /** Caller ID of the inbound leg, E.164. */
    fromNumber: text("from_number").notNull(),

    // Twilio identifiers
    twilioCallSid: text("twilio_call_sid").notNull().unique(),
    dialCallSid: text("dial_call_sid").unique(),
    recordingSid: text("recording_sid").unique(),
    recordingStatus: text("recording_status").$type<RecordingStatus>(),

    // Pipeline state and claims
    status: text("status").$type<CallStatus>().notNull(),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastError: text("last_error"),
    transcribeAttempts: integer("transcribe_attempts").notNull().default(0),

    // Timing
    inboundAt: timestamp("inbound_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    recordingStartedAt: timestamp("recording_started_at", {
      withTimezone: true,
    }),
    recordingDurationSec: integer("recording_duration_sec"),
    dialDurationSec: integer("dial_duration_sec"),

    // Transcript (reduced shape, never word arrays or URLs)
    transcript: jsonb("transcript").$type<StoredTranscript>(),
    /** Pure function of the transcript jsonb. */
    transcriptText: text("transcript_text"),

    // Email tracking, separate from status
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailClaimedAt: timestamp("email_claimed_at", { withTimezone: true }),
    lastEmailError: text("last_email_error"),
    metadataEmailSentAt: timestamp("metadata_email_sent_at", {
      withTimezone: true,
    }),
    transcriptEmailSentAt: timestamp("transcript_email_sent_at", {
      withTimezone: true,
    }),
    emailMessageId: text("email_message_id"),
    emailedTo: text("emailed_to"),

    // Answering machine detection on the outbound leg
    /**
     * Raw Twilio AnsweredBy: human, machine_start, machine_end_beep,
     * machine_end_silence, machine_end_other, fax, unknown. Null until the
     * AMD callback arrives.
     */
    answeredBy: text("answered_by"),
    machineDetectionDurationMs: integer("machine_detection_duration_ms"),
    /** Set at transcription time: the caller said something on channel 0. */
    callerSpoke: boolean("caller_spoke"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("call_user_id_inbound_at_idx").on(
      table.userId,
      table.inboundAt.desc()
    ),
  ]
);

export type Call = typeof call.$inferSelect;
export type NewCall = typeof call.$inferInsert;
