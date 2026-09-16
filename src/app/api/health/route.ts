import { NextResponse } from "next/server";

import { checkPrimaryConnection } from "@/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Liveness check endpoint
 *
 * Returns 200 if the app is running, regardless of dependency status.
 * This prevents container restarts during temporary DB hiccups.
 *
 * Use this for:
 * - ECS container health checks (HEALTHCHECK in Dockerfile)
 * - Kubernetes liveness probes
 *
 * Use /api/ready for:
 * - ALB/ELB target group health checks (returns 503 if DB is down)
 *
 * The body carries status and timestamp only. Details (timing, error text)
 * go to the log, never to an unauthenticated caller.
 */
export async function GET() {
  const startTime = Date.now();

  try {
    // Check database connectivity (informational only for liveness)
    const dbHealthy = await checkPrimaryConnection();
    const duration = Date.now() - startTime;

    if (!dbHealthy) {
      logger.warn("health_check_db_degraded", { duration_ms: duration });
    } else {
      logger.debug("health_check_passed", { duration_ms: duration });
    }

    // Always return 200: the app is alive
    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.exception("health_check_error", error, { duration_ms: duration });

    // Still return 200: the app is alive, just has an issue
    return NextResponse.json({
      status: "degraded",
      timestamp: new Date().toISOString(),
    });
  }
}
