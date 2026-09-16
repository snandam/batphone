import { z } from "zod";

import { MAX_SPEED_DIAL } from "@/lib/batphone/speed-dial";

/**
 * Contact schemas
 *
 * The name is checked for shape only; `normalizeContactName` in
 * `@/lib/batphone/speed-dial` decides whether it is sayable. The phone is
 * validated for shape only; `normalizeToE164` decides whether it is a
 * real number. The speed dial arrives as a form string; empty means
 * "assign the next one automatically".
 */

const contactNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(100, "Name must be 100 characters or fewer");

const contactPhoneSchema = z
  .string()
  .trim()
  .min(1, "Enter a phone number")
  .max(32, "Phone number is too long");

const SPEED_DIAL_MESSAGE = `Enter a whole number from 1 to ${MAX_SPEED_DIAL}`;

const speedDialSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }
    return value;
  },
  z.coerce
    .number({ message: SPEED_DIAL_MESSAGE })
    .int(SPEED_DIAL_MESSAGE)
    .min(1, SPEED_DIAL_MESSAGE)
    .max(MAX_SPEED_DIAL, SPEED_DIAL_MESSAGE)
    .optional()
);

export const createContactSchema = z.object({
  name: contactNameSchema,
  phone: contactPhoneSchema,
  speedDial: speedDialSchema,
});

export const contactIdSchema = z.object({
  id: z.string().trim().min(1, "Contact is required").max(64),
});

export const updateContactSchema = contactIdSchema.extend(
  createContactSchema.shape
);

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactIdInput = z.infer<typeof contactIdSchema>;
