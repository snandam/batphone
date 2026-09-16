/**
 * Sends one sample transcript email through the configured mailer.
 *
 * Usage: npm run email:test -- someone@example.com
 * Without an address it sends to SEED_EMAIL. Honours EMAIL_DRY_RUN.
 */

import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const [{ renderTranscriptEmail }, { createMailer }] = await Promise.all([
    import("../src/lib/batphone/email-templates"),
    import("../src/lib/batphone/mailer"),
  ]);

  const to = process.argv[2] || process.env.SEED_EMAIL;
  if (!to) {
    console.error("Usage: npm run email:test -- someone@example.com");
    process.exit(2);
  }

  const rendered = renderTranscriptEmail({
    callerName: "Bat Phone test",
    contactName: "Sample Contact",
    destinationNumber: "+16045550123",
    startedAt: new Date(),
    durationSec: 62,
    outcome: "Completed",
    timeZone: "America/Vancouver",
    callPageUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/calls/sample`,
    transcript: {
      model: "nova-3",
      requestId: "email-test",
      channelConfidence: [0.97, 0.95],
      identicalChannels: false,
      utterances: [
        {
          channel: 0,
          start: 0.4,
          end: 2.1,
          text: "Hi, this is a test of the Bat Phone email.",
          confidence: 0.97,
        },
        {
          channel: 1,
          start: 2.6,
          end: 4.9,
          text: "Received loud and clear.",
          confidence: 0.95,
        },
      ],
    },
  });

  const mailer = createMailer();
  console.log(`Sending via ${mailer.name} to ${to}: "${rendered.subject}"`);
  const result = await mailer.send({
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    callId: "email-test",
    kind: "transcript",
  });
  console.log(result);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("email:test failed:", error);
  process.exit(1);
});
