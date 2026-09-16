/**
 * Twilio webhook foundation
 *
 * Shared by every /api/twilio/* route handler: signature validation
 * against the configured public base URL, the append-only event log,
 * binding a callback to its call row, and the response helpers. Domain
 * module: no Next.js imports, only the web Request and Response types.
 */

import { validateRequest } from "twilio";

import type { Call } from "@/db/schema";
import { logger, type LogContext } from "@/lib/logger";

import * as repo from "./calls-repo";
import { publicBaseUrl, twilioAuthToken, voiceSettings } from "./config";
import { apology, goodbyeNotFound } from "./twiml";

/**
 * Largest body accepted. Twilio's largest voice webhook is a few hundred
 * bytes; the routes are reachable by anyone who finds the public URL.
 */
export const MAX_BODY_BYTES = 8192;

/** A callback is only honoured while its call is younger than this. */
const MAX_CALL_AGE_MS = 24 * 60 * 60 * 1000;

const SIGNATURE_HEADER = "x-twilio-signature";

export type TwilioParams = Record<string, string>;

export type ParsedTwilioRequest =
  | { ok: true; params: TwilioParams; query: URLSearchParams }
  | { ok: false; response: Response };

export function twimlResponse(twiml: string): Response {
  return new Response(twiml, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

/**
 * Read the form body once as a flat string map. Non-string entries (files)
 * are ignored; Twilio never sends them.
 */
async function readFormParams(request: Request): Promise<TwilioParams | null> {
  try {
    const form = await request.formData();
    const params: TwilioParams = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params[key] = value;
    }
    return params;
  } catch {
    return null;
  }
}

/**
 * Validate a webhook and return its params and query string.
 *
 * The signed URL is the configured public base URL plus the request path
 * plus the raw query string exactly as received. Inside Codespaces the app
 * sees a localhost request URL while Twilio signed the public HTTPS URL,
 * and re-serialising the query can reorder or re-encode it, so neither
 * `request.url` nor a rebuilt query is used.
 */
export async function parseTwilioRequest(
  request: Request
): Promise<ParsedTwilioRequest> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    logger.warn("twilio_request_too_large", {
      path: requestPath(request),
      content_length: declaredLength,
    });
    return { ok: false, response: emptyResponse(413) };
  }

  const url = new URL(request.url);
  const signature = request.headers.get(SIGNATURE_HEADER);
  const authToken = twilioAuthToken();
  if (!authToken) {
    logger.error("twilio_auth_token_missing", { path: url.pathname });
    return { ok: false, response: emptyResponse(403) };
  }
  if (!signature) {
    logger.warn("twilio_signature_missing", { path: url.pathname });
    return { ok: false, response: emptyResponse(403) };
  }

  const params = await readFormParams(request);
  if (params === null) {
    logger.warn("twilio_body_unreadable", { path: url.pathname });
    return { ok: false, response: emptyResponse(403) };
  }

  const signedUrl = `${publicBaseUrl()}${url.pathname}${url.search}`;
  if (!validateRequest(authToken, signature, signedUrl, params)) {
    logger.warn("twilio_signature_invalid", { path: url.pathname });
    return { ok: false, response: emptyResponse(403) };
  }

  return { ok: true, params, query: new URLSearchParams(url.search) };
}

export type TwilioEventKind =
  | "voice"
  | "gather"
  | "confirm"
  | "dial-status"
  | "recording"
  | "amd-status"
  | "call-status";

/** Append the verified callback to the event log before any handler logic. */
export async function recordEvent(
  params: TwilioParams,
  kind: TwilioEventKind
): Promise<void> {
  await repo.insertEvent({
    callSid: params.CallSid ?? "unknown",
    recordingSid: params.RecordingSid ?? null,
    eventKind: kind,
    payload: params,
    receivedAt: new Date(),
  });
}

export type BindRejectReason =
  | "missing_call"
  | "sid_mismatch"
  | "expired"
  | "foreign_contact"
  | "bad_attempt";

export type BoundCall =
  | { ok: true; row: Call; attempt: number }
  | { ok: false; reason: BindRejectReason; response: Response };

export interface BindCallDeps {
  getCallById: (id: string) => Promise<Call | null>;
  /** Ids of every contact the user owns. */
  loadContactIds: (userId: string) => Promise<string[]>;
  now?: () => Date;
}

const defaultBindDeps: BindCallDeps = {
  getCallById: (id) => repo.getCallById(id),
  loadContactIds: async (userId) =>
    (await repo.listContactsForUser(userId)).map((c) => c.id),
};

function parseAttempt(value: string | null): number | null {
  if (value === null) return 1;
  if (!/^\d+$/.test(value)) return null;
  const attempt = Number(value);
  return attempt >= 1 ? attempt : null;
}

/** Contact ids named in the query: `contactId` and the comma-separated `candidates`. */
function contactIdsInQuery(query: URLSearchParams): string[] {
  const ids: string[] = [];
  const contactId = query.get("contactId");
  if (contactId) ids.push(contactId);
  for (const id of (query.get("candidates") ?? "").split(",")) {
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * An unknown call id means the app lost the row, so the caller hears the
 * apology; every other mismatch is a plain goodbye.
 */
function reject(reason: BindRejectReason, context: LogContext): BoundCall {
  logger.warn("twilio_bind_rejected", { reason, ...context });
  const twiml =
    reason === "missing_call"
      ? apology(voiceSettings())
      : goodbyeNotFound(voiceSettings());
  return { ok: false, reason, response: twimlResponse(twiml) };
}

/**
 * Load the call row named by the query and check that this callback
 * belongs to it: the body's CallSid matches, the row is younger than 24
 * hours, and every contact id in the query is owned by the row's user.
 * Any mismatch is a goodbye (or the apology for an unknown call id) with
 * no writes.
 */
export async function bindCall(
  params: TwilioParams,
  query: URLSearchParams,
  deps: BindCallDeps = defaultBindDeps
): Promise<BoundCall> {
  const callId = query.get("callId");
  const callSid = params.CallSid ?? "";
  if (!callId) return reject("missing_call", { call_sid: callSid });

  const row = await deps.getCallById(callId);
  if (!row)
    return reject("missing_call", { call_id: callId, call_sid: callSid });

  const context = callLogContext(row);
  if (row.twilioCallSid !== callSid) {
    return reject("sid_mismatch", { ...context, request_call_sid: callSid });
  }

  const now = deps.now?.() ?? new Date();
  if (now.getTime() - row.inboundAt.getTime() > MAX_CALL_AGE_MS) {
    return reject("expired", context);
  }

  const attempt = parseAttempt(query.get("attempt"));
  if (attempt === null) return reject("bad_attempt", context);

  const requested = contactIdsInQuery(query);
  if (requested.length > 0) {
    const owned = new Set(await deps.loadContactIds(row.userId));
    if (requested.some((id) => !owned.has(id))) {
      return reject("foreign_contact", context);
    }
  }

  return { ok: true, row, attempt };
}

export type CallLogContext = {
  call_id: string;
  call_sid: string;
  status: string;
  attempt?: number;
};

/**
 * The only call fields a handler may log. Never numbers, names, speech, or
 * transcript text.
 */
export function callLogContext(
  row: Pick<Call, "id" | "twilioCallSid" | "status">,
  attempt?: number
): CallLogContext {
  const context: CallLogContext = {
    call_id: row.id,
    call_sid: row.twilioCallSid,
    status: row.status,
  };
  if (attempt !== undefined) context.attempt = attempt;
  return context;
}

export type TwilioHandler = (request: Request) => Promise<Response>;

/**
 * A thrown error becomes a 200 with the apology TwiML. A 5xx would make
 * Twilio play its own "application error" message to the caller.
 */
export function withTwiml(handler: TwilioHandler): TwilioHandler {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      logger.exception("twilio_handler_error", error, {
        path: requestPath(request),
      });
      return twimlResponse(apology(voiceSettings()));
    }
  };
}
