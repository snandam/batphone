import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * User Profile Table
 *
 * Extended user data beyond what Better Auth stores.
 * Links to the auth user table via userId.
 *
 * ID convention: all tables use text PKs with auto-generated UUIDs.
 * Lookups use userId, not id; the id column exists as a standard PK.
 *
 * Bat Phone columns: the verified phone number that identifies the caller
 * on the inbound webhook and the IANA timezone used in emails and the UI.
 * The contacts action also locks this row to serialise speed-dial
 * allocation for one user.
 */
export const userProfile = pgTable("user_profile", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),

  /** Explicit onboarding names, independent of Google display name. */
  firstName: text("first_name"),
  lastName: text("last_name"),

  /** E.164. Null until verified; unique so a number maps to one caller. */
  phoneNumber: text("phone_number").unique(),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  /** IANA zone name. */
  timezone: text("timezone").notNull().default("UTC"),

  /** Set once after the first personal contact is saved; not cleared on deletion. */
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Type inference helpers
export type UserProfile = typeof userProfile.$inferSelect;
export type NewUserProfile = typeof userProfile.$inferInsert;
