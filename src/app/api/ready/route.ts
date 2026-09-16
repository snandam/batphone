import { NextResponse } from "next/server";

import { checkPrimaryConnection } from "@/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Readiness check endpoint
 *
 * This is a READINESS check: returns 200 only if the app can serve requests.
 * Returns 503 if dependencies (database) are unavailable.
 *
 * Use this for:
 * - ALB/ELB target group health checks (stop routing traffic to unhealthy instances)
 * - Kubernetes readiness probes
 *
 * Use /api/health for:
 * - ECS container health checks (liveness: should the container be restarted?)
 *
 * The body carries status, database, and timestamp only. Details (timing,
 * error text) go to the log, never to an unauthenticated caller.
 */
export async function GET() {
  const startTime = Date.now();

  try {
    const dbHealthy = await checkPrimaryConnection();
    const duration = Date.now() - startTime;

    if (!dbHealthy) {
      logger.warn("readiness_check_failed", {
        reason: "database_unavailable",
        duration_ms: duration,
      });

      return NextResponse.json(
        {
          status: "not_ready",
          database: "unavailable",
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    logger.debug("readiness_check_passed", { duration_ms: duration });

    return NextResponse.json({
      status: "ready",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.exception("readiness_check_error", error, { duration_ms: duration });

    return NextResponse.json(
      {
        status: "not_ready",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
