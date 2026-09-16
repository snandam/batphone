/**
 * Structured Logger
 *
 * JSON-formatted logs optimized for CloudWatch and debugging.
 * All logs include: timestamp, level, event, service, environment
 *
 * Service name is configurable via NEXT_PUBLIC_APP_NAME environment variable.
 *
 * Redaction: every context value and every error message passes through
 * `redactValue` before it is written. Phone numbers in E.164 form are
 * masked to their last two digits and long strings are truncated, so a
 * handler that logs a Twilio payload or an error mentioning a number can
 * never put a full number in the log. Handlers still log only a safe call
 * context (see callLogContext in src/lib/batphone/twilio-request.ts).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  request_id?: string;
  user_id?: string;
  path?: string;
  method?: string;
  duration_ms?: number;
  status_code?: number;
  error_message?: string;
  error_stack?: string;
  [key: string]: unknown;
}

// Use app name from env, fallback to "app"
const SERVICE =
  process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase().replace(/\s+/g, "-") || "app";
const ENVIRONMENT = process.env.NODE_ENV || "development";

/** Longest string written to a log line before truncation. */
const MAX_STRING_LENGTH = 500;
const TRUNCATED_SUFFIX = "…[truncated]";
/** Deepest nesting redacted; anything deeper is replaced with a marker. */
const MAX_DEPTH = 8;

/** A plus sign followed by 7 to 15 digits: every E.164 number, and nothing shorter. */
const E164_PATTERN = /\+\d{7,15}/g;

/**
 * Mask an E.164 match: keep the plus and the first digit so the country is
 * still recognisable, star every remaining digit except the last two.
 * +15551234567 becomes +1*********67.
 */
function maskNumber(match: string): string {
  const digits = match.slice(1);
  return `+${digits[0]}${"*".repeat(digits.length - 2)}${digits.slice(-2)}`;
}

function redactString(value: string): string {
  const masked = value.replace(E164_PATTERN, maskNumber);
  if (masked.length <= MAX_STRING_LENGTH) return masked;
  return `${masked.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_SUFFIX}`;
}

/**
 * Redact one value recursively. Strings are masked and truncated; arrays
 * and plain objects are walked; Dates become ISO strings; Errors become
 * their redacted message; other primitives pass through.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactString(value.message);
  if (depth >= MAX_DEPTH) return "[depth limit]";
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactValue(item, depth + 1);
  }
  return out;
}

function redactContext(context: LogContext): Record<string, unknown> {
  return redactValue(context) as Record<string, unknown>;
}

function formatLog(
  level: LogLevel,
  event: string,
  context: LogContext = {}
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: SERVICE,
    environment: ENVIRONMENT,
    ...redactContext(context),
  });
}

export const logger = {
  debug(event: string, context?: LogContext) {
    if (ENVIRONMENT === "development") {
      console.debug(formatLog("debug", event, context));
    }
  },

  info(event: string, context?: LogContext) {
    console.info(formatLog("info", event, context));
  },

  warn(event: string, context?: LogContext) {
    console.warn(formatLog("warn", event, context));
  },

  error(event: string, context?: LogContext) {
    console.error(formatLog("error", event, context));
  },

  /**
   * Log an error with stack trace. The message and stack are redacted like
   * any other context value.
   */
  exception(event: string, error: unknown, context?: LogContext) {
    const errorContext: LogContext = { ...context };

    if (error instanceof Error) {
      errorContext.error_message = error.message;
      errorContext.error_stack = error.stack;
    } else {
      errorContext.error_message = String(error);
    }

    console.error(formatLog("error", event, errorContext));
  },

  /**
   * Log HTTP request (call at start of request)
   */
  request(method: string, path: string, requestId?: string) {
    this.info("http_request_started", {
      method,
      path,
      request_id: requestId,
    });
  },

  /**
   * Log HTTP response (call at end of request)
   */
  response(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number,
    requestId?: string
  ) {
    const level: LogLevel =
      statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    const event =
      statusCode >= 500 ? "http_request_error" : "http_request_completed";

    this[level](event, {
      method,
      path,
      status_code: statusCode,
      duration_ms: durationMs,
      request_id: requestId,
    });
  },
};

export type { LogContext, LogLevel };
