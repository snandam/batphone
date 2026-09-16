/**
 * Validation Utilities
 *
 * This module provides Zod-based validation for all data inputs.
 * Use these schemas in server actions, API routes, and forms.
 *
 * @example
 * import { mySchema, validateInput } from "@/lib/validations";
 *
 * // In a server action:
 * const result = validateInput(mySchema, data);
 * if (!result.success) {
 *   return { success: false, error: result.error };
 * }
 * // Use result.data (typed and validated)
 */

import { z } from "zod";

// Re-export zod for convenience
export { z } from "zod";

// Domain schemas
export {
  contactIdSchema,
  createContactSchema,
  updateContactSchema,
  type ContactIdInput,
  type CreateContactInput,
  type UpdateContactInput,
} from "./contacts";
export {
  confirmPhoneSchema,
  phoneInputSchema,
  verificationCodeSchema,
  type ConfirmPhoneInput,
  type PhoneInput,
} from "./phone";

/**
 * Validation result type
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Validate input against a Zod schema
 *
 * Returns a discriminated union with either validated data or error message.
 * Use this in server actions to validate user input.
 *
 * @example
 * const result = validateInput(mySchema, data);
 * if (!result.success) {
 *   return { success: false, error: result.error };
 * }
 * // result.data is now typed and validated
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    // Format Zod errors into a readable string
    const errors = result.error.issues
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    return { success: false, error: errors || "Validation failed" };
  }

  return { success: true, data: result.data };
}

/**
 * Common validation patterns
 */
export const patterns = {
  /** UUID v4 pattern */
  uuid: z.string().uuid(),

  /** Email address */
  email: z.string().email(),

  /** URL (http or https) */
  url: z.string().url(),

  /** Non-empty string */
  nonEmptyString: z.string().min(1, "Cannot be empty"),

  /** Positive integer */
  positiveInt: z.number().int().positive(),

  /** Non-negative integer (0 or greater) */
  nonNegativeInt: z.number().int().nonnegative(),
};
