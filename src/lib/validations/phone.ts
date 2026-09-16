import { z } from "zod";

/**
 * Phone setup schemas
 *
 * The number is validated for shape only here; `normalizeToE164` in
 * `@/lib/batphone/phone` decides whether it is a real number. The code is
 * the six digits Twilio Verify sends.
 */

export const phoneInputSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, "Enter a phone number")
    .max(32, "Phone number is too long"),
});

export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from the text message");

export const confirmPhoneSchema = phoneInputSchema.extend({
  code: verificationCodeSchema,
  timezone: z.string().trim().max(64).optional(),
});

export type PhoneInput = z.infer<typeof phoneInputSchema>;
export type ConfirmPhoneInput = z.infer<typeof confirmPhoneSchema>;
