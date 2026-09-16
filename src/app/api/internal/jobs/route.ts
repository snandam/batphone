import { timingSafeEqual } from "node:crypto";

import {
  executeBackgroundJob,
  isBackgroundJob,
} from "@/lib/batphone/background-jobs";
import { logger } from "@/lib/logger";

/** Only the queue consumer can submit jobs; browser sessions do not authorize this route. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.BATPHONE_JOB_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (
    !secret ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return new Response(null, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!isBackgroundJob(body)) return new Response(null, { status: 400 });
  try {
    return Response.json(await executeBackgroundJob(body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logger.exception("queue_job_failed", error, { call_id: body.callId });
    return new Response(null, { status: 503 });
  }
}
