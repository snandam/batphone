import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Twilio Event Table
 *
 * Append-only log of every verified webhook Twilio delivers. Rows are
 * written before any handler logic runs so a failed handler can be
 * replayed from its payload. There is no foreign key to call: events can
 * arrive for SIDs the app has never seen (unknown callers, late callbacks
 * after a delete), and they still need to be recorded.
 */
export const twilioEvent = pgTable(
  "twilio_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    callSid: text("call_sid").notNull(),
    recordingSid: text("recording_sid"),
    /** Which webhook produced it: voice, gather, dial_action, call_status, recording_status. */
    eventKind: text("event_kind").notNull(),
    /** Verified form body. Never logged; phone numbers live here. */
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("twilio_event_call_sid_idx").on(table.callSid)]
);

export type TwilioEvent = typeof twilioEvent.$inferSelect;
export type NewTwilioEvent = typeof twilioEvent.$inferInsert;
