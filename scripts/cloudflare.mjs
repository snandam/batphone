/** Build/deploy without baking local server or operator credentials into the Worker. */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "jsonc-parser";

const command = process.argv[2] ?? "build";
if (!["build", "preview", "deploy"].includes(command))
  throw new Error("Unknown Cloudflare command");
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
const origin = config.vars.PUBLIC_BASE_URL;
const env = {
  ...process.env,
  BATPHONE_CLOUDFLARE: "true",
  PUBLIC_BASE_URL: origin,
  BETTER_AUTH_URL: origin,
  NEXT_PUBLIC_APP_URL: origin,
  NEXT_PUBLIC_SUPPORT_EMAIL:
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL ||
    config.vars.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_BAT_PHONE_NUMBER:
    process.env.NEXT_PUBLIC_BAT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER,
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ||
    process.env.DATABASE_URL ||
    "postgresql://build:build@localhost:5432/build",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "build-only-not-runtime-credential-123456",
  GOOGLE_CLIENT_ID: "build-dummy",
  GOOGLE_CLIENT_SECRET: "build-dummy",
};
function run(args) {
  const result = spawnSync(
    "npx",
    ["--no-install", "opennextjs-cloudflare", ...args],
    { env, stdio: "inherit" }
  );
  if (result.status !== 0)
    throw new Error(`Cloudflare command failed (exit ${result.status ?? 1}).`);
}
run(["build"]);
// OpenNext compiles .env files into this module, including .env.local. All
// deployed server settings must instead come from Worker bindings/secrets.
writeFileSync(
  ".open-next/cloudflare/next-env.mjs",
  "export const production = {};\nexport const development = {};\nexport const test = {};\n"
);
const secrets = Object.entries(process.env).filter(
  ([name, value]) =>
    !name.startsWith("NEXT_PUBLIC_") &&
    /SECRET|PASSWORD|TOKEN|API_KEY/.test(name) &&
    value?.length >= 12
);
let leaked = false;
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) inspect(path);
    else if (entry.isFile()) {
      const contents = readFileSync(path);
      for (const [name, value] of secrets) {
        if (contents.includes(Buffer.from(value))) {
          console.error(`Refusing upload: credential ${name} found in ${path}`);
          leaked = true;
        }
      }
    }
  }
}
inspect(".open-next");
if (leaked) process.exit(1);
console.log("Worker artifact credential check passed.");
if (command === "deploy") {
  const required = [
    "BETTER_AUTH_SECRET",
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
    "BATPHONE_JOB_SECRET",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (!process.env.ALLOWED_EMAILS && !process.env.ALLOWED_EMAIL_DOMAINS)
    missing.push("ALLOWED_EMAILS or ALLOWED_EMAIL_DOMAINS");
  if (missing.length)
    throw new Error(`Missing runtime settings: ${missing.join(", ")}`);
  const optional = [
    "ALLOWED_EMAILS",
    "ALLOWED_EMAIL_DOMAINS",
    "EMAIL_FROM_NAME",
    "TWILIO_VOICE",
    "TWILIO_SPEECH_MODEL",
    "DEFAULT_PHONE_REGION",
  ];
  const runtimeSecrets = Object.fromEntries(
    [...required, ...optional]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]])
  );
  const directory = mkdtempSync(join(tmpdir(), "batphone-deploy-"));
  const file = join(directory, "secrets.json");
  try {
    writeFileSync(file, JSON.stringify(runtimeSecrets), { mode: 0o600 });
    run(["deploy", "--secrets-file", file, ...process.argv.slice(3)]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
} else if (command === "preview") {
  run(["preview", ...process.argv.slice(3)]);
}
