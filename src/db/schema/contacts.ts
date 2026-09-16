import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Contact Table
 *
 * One row per saved contact. Names are unique per user after
 * normalisation because the bat phone matches contacts by spoken name.
 * Phone numbers are not unique: two contacts may share a line (R27).
 * Speed-dial codes are unique per user. An automatic code is the lowest
 * positive number none of the user's contacts uses, so a deleted
 * contact's code becomes free again. A user-chosen code must be unique
 * too; the index below enforces both.
 */
export const contact = pgTable(
  "contact",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** See normalizeContactName in src/lib/batphone/speed-dial.ts. */
    nameNormalized: text("name_normalized").notNull(),
    /** E.164. */
    phone: text("phone").notNull(),
    speedDial: integer("speed_dial").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("contact_user_id_idx").on(table.userId),
    uniqueIndex("contact_user_id_name_normalized_idx").on(
      table.userId,
      table.nameNormalized
    ),
    uniqueIndex("contact_user_id_speed_dial_idx").on(
      table.userId,
      table.speedDial
    ),
  ]
);

export type Contact = typeof contact.$inferSelect;
export type NewContact = typeof contact.$inferInsert;
