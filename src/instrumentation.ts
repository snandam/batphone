/**
 * Next.js Instrumentation
 *
 * This file runs once when the server starts.
 * Used for startup logging and connection verification.
 */

export async function register() {
  // Workers have no process startup/shutdown lifecycle. Database probes run
  // through readiness requests, inside a request-scoped Hyperdrive connection.
  if (process.env.BATPHONE_CLOUDFLARE === "true") return;
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("@/lib/logger");
    const {
      emailDryRun,
      invalidTwilioSpeechModel,
      publicBaseUrl,
      TWILIO_SPEECH_MODELS,
      twilioSpeechModel,
    } = await import("@/lib/batphone/config");

    logger.info("server_starting", {
      node_env: process.env.NODE_ENV,
      port: process.env.PORT || "3000",
    });

    // Every Twilio callback URL and the signature check are built from this
    // value, so log it where a wrong PUBLIC_BASE_URL is visible at a glance.
    logger.info("public_base_url_resolved", {
      public_base_url: publicBaseUrl(),
      source: process.env.PUBLIC_BASE_URL
        ? "PUBLIC_BASE_URL"
        : process.env.CODESPACES === "true"
          ? "codespaces"
          : "default",
    });

    // Verify database connection on startup
    try {
      const { checkPrimaryConnection } = await import("@/db");
      const dbConnected = await checkPrimaryConnection();

      if (dbConnected) {
        logger.info("startup_database_connected");
      } else {
        logger.error("startup_database_failed", {
          error_message: "Could not connect to database",
        });
      }
    } catch (error) {
      logger.exception("startup_database_error", error);
    }

    // Log environment check (without exposing secrets)
    // DB can be configured via DB_HOST or DATABASE_URL
    const hasDbConfig = process.env.DB_HOST || process.env.DATABASE_URL;
    const requiredEnvVars = [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_API_KEY_SID",
      "TWILIO_API_KEY_SECRET",
      "TWILIO_PHONE_NUMBER",
      "TWILIO_VERIFY_SERVICE_SID",
      "DEEPGRAM_API_KEY",
      "EMAIL_FROM",
    ];

    const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
    if (!hasDbConfig) {
      missingVars.push("DB_HOST or DATABASE_URL");
    }
    // The sign-in allowlist needs at least one list. With both empty every
    // sign-in is rejected, which looks like a broken OAuth setup.
    const hasAllowlist =
      process.env.ALLOWED_EMAILS?.trim() ||
      process.env.ALLOWED_EMAIL_DOMAINS?.trim();
    if (!hasAllowlist) {
      missingVars.push("ALLOWED_EMAILS or ALLOWED_EMAIL_DOMAINS");
    }

    if (missingVars.length > 0) {
      logger.error("startup_env_missing", {
        missing_vars: missingVars,
      });
    } else {
      logger.info("startup_env_verified", {
        // required vars plus the database and allowlist "at least one of" checks
        vars_checked: requiredEnvVars.length + 2,
      });
    }

    const badSpeechModel = invalidTwilioSpeechModel();
    if (badSpeechModel) {
      logger.warn("twilio_speech_model_invalid", {
        configured: badSpeechModel,
        using: twilioSpeechModel(),
        allowed: TWILIO_SPEECH_MODELS,
      });
    }

    if (emailDryRun()) {
      logger.warn("email_dry_run_active", {
        hint: "Emails are rendered and logged, not sent. Unset EMAIL_DRY_RUN to send.",
      });
    }

    logger.info("server_ready");

    // Graceful shutdown: node server.js is PID 1 in the container. Without
    // this, a SIGTERM from ECS/Kubernetes during a rollout exits immediately
    // and in-flight queries fail with dropped connections. Close the pool,
    // then exit.
    const shutdown = async (signal: string) => {
      logger.info("shutdown_signal_received", { signal });
      try {
        const { closePrimaryConnection } = await import("@/db");
        await closePrimaryConnection();
        logger.info("shutdown_connections_closed");
      } catch (error) {
        logger.exception("shutdown_close_error", error);
      }
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}
