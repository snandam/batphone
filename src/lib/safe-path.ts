/**
 * Accept only same-origin absolute paths for post-login redirects.
 *
 * `startsWith("/")` alone is an open redirect: `//evil.example/x` is a
 * protocol-relative URL, and `/\evil.example` is normalised to the same thing
 * by browsers. Both pass a naive check and navigate off-site after sign-in.
 */
export function isSafePath(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}

/** Return the value when it is a safe same-origin path, otherwise the fallback. */
export function safePathOr(
  value: string | null | undefined,
  fallback = "/"
): string {
  return isSafePath(value) ? value : fallback;
}
