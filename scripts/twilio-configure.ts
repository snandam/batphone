/**
 * Point the bat phone number at this app.
 *
 * Usage:
 *   npm run twilio:configure
 *
 * Reads TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET and
 * TWILIO_PHONE_NUMBER (required), TWILIO_VERIFY_SERVICE_SID and
 * TWILIO_FALLBACK_TWIML_URL (optional), and PUBLIC_BASE_URL or the
 * Codespaces variables to derive the webhook URLs. Prints every value it set.
 * The logic lives in src/lib/batphone/twilio-configure.ts so it can be tested
 * with a fake client.
 */

import { loadEnvConfig } from "@next/env";

import {
  configureTwilio,
  formatConfigureResult,
  readConfigureEnv,
  sdkConfigureClient,
} from "@/lib/batphone/twilio-configure";

// Load .env.local (and other .env files) the same way Next.js does.
loadEnvConfig(process.cwd());

async function main() {
  const env = readConfigureEnv();
  const client = await sdkConfigureClient();
  const result = await configureTwilio(client, env);
  console.log(formatConfigureResult(result));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`twilio:configure failed: ${message}`);
  process.exit(1);
});
