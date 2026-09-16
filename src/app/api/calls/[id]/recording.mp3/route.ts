import { auth } from "@/lib/auth";
import { getCallById } from "@/lib/batphone/calls-repo";
import {
  twilioAccountUrl,
  twilioAuthorization,
} from "@/lib/batphone/twilio-media";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Authenticated recording proxy (R19, AE8)
 *
 * Streams the MP3 from Twilio for the signed-in owner of the call. The
 * browser never sees a Twilio URL or credential: the route checks the
 * session and ownership, fetches with the API key, and relays only the
 * headers a media element needs. A single byte range is forwarded so
 * mobile Safari can seek; a multi-range request is served as the whole
 * file rather than passed through as multipart. Any upstream status other
 * than 200 or 206 becomes an empty 502 so Twilio's error body and its
 * WWW-Authenticate challenge never reach the browser.
 */

const RELAYED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
] as const;

const SINGLE_RANGE = /^bytes=\d*-\d*$/;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function baseHeaders(): Headers {
  return new Headers({
    "cache-control": "private, no-store",
    "content-disposition": "inline",
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: baseHeaders() });
}

/** The browser's Range header when it names exactly one range; else null. */
function singleRange(request: Request): string | null {
  const range = request.headers.get("range")?.trim() ?? "";
  return SINGLE_RANGE.test(range) ? range : null;
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return empty(401);

  const { id } = await context.params;
  const row = await getCallById(id);
  if (!row || row.userId !== session.user.id || !row.recordingSid) {
    return empty(404);
  }

  const upstreamHeaders: Record<string, string> = {
    Authorization: twilioAuthorization(),
    Accept: "audio/mpeg",
  };
  const range = singleRange(request);
  if (range) upstreamHeaders.Range = range;

  const logContext = {
    call_id: row.id,
    recording_sid: row.recordingSid,
    ranged: range !== null,
  };

  let upstream: Response;
  try {
    upstream = await fetch(
      twilioAccountUrl(
        `Recordings/${encodeURIComponent(row.recordingSid)}.mp3`
      ),
      { method: "GET", headers: upstreamHeaders, redirect: "follow" }
    );
  } catch (error) {
    logger.exception("recording_proxy_upstream_error", error, logContext);
    return empty(502);
  }

  if (upstream.status !== 200 && upstream.status !== 206) {
    logger.error("recording_proxy_upstream_error", {
      ...logContext,
      upstream_status: upstream.status,
    });
    await upstream.body?.cancel();
    return empty(502);
  }

  const headers = baseHeaders();
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
