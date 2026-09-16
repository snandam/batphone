import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type {
  CallerResponse,
  ResolutionCandidate,
  ResolutionDecision,
  ResolutionInputKind,
} from "@/lib/batphone/state";

import { call } from "./calls";

/**
 * Resolution Attempt Table
 *
 * One row per gather callback while a call is identifying its contact
 * (R26): what the caller said or typed, what the matcher heard and scored,
 * the decision, and what the caller did next. Deleted with the call.
 *
 * chosen_contact_id has no foreign key: it is a snapshot of the matcher's
 * pick and must survive the contact being deleted later.
 */
export const resolutionAttempt = pgTable(
  "resolution_attempt",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    callId: text("call_id")
      .notNull()
      .references(() => call.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    inputKind: text("input_kind").$type<ResolutionInputKind>().notNull(),
    /** Twilio SpeechResult or Digits, as received. */
    heardText: text("heard_text").notNull(),
    confidence: real("confidence"),
    normalizedQuery: text("normalized_query").notNull(),
    candidates: jsonb("candidates").$type<ResolutionCandidate[]>().notNull(),
    decision: text("decision").$type<ResolutionDecision>().notNull(),
    chosenContactId: text("chosen_contact_id"),
    callerResponse: text("caller_response").$type<CallerResponse>(),
    selectedPosition: integer("selected_position"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [index("resolution_attempt_call_id_idx").on(table.callId)]
);

export type ResolutionAttempt = typeof resolutionAttempt.$inferSelect;
export type NewResolutionAttempt = typeof resolutionAttempt.$inferInsert;
