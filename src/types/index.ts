/**
 * Shared TypeScript type definitions
 */

/**
 * Server action result type
 *
 * Discriminated union for server action return values.
 * Used across all server action files.
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
