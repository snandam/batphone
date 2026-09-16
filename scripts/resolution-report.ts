/**
 * Resolution report: every name-resolution attempt across all calls.
 *
 * Usage:
 *   npm run resolution:report
 *   npm run resolution:report -- --since 2026-09-01
 *   npm run resolution:report -- --since 2026-09-01T00:00:00Z
 *
 * Prints one row per resolution attempt (R26) ordered by the call's inbound
 * time and then the attempt number: when it happened, whether the caller
 * spoke or typed, what Twilio heard, the recognition confidence, the top
 * three matcher candidates with their scores, the matcher's decision, and
 * what the caller did next. Feed misses and false matches from this output
 * into the matcher test table (see "Tuning the matcher" in the README).
 *
 * `--since` keeps only calls whose inbound time is at or after the given
 * ISO 8601 date or date-time. Exits 0 with "No attempts recorded" when
 * nothing matches.
 */

import { loadEnvConfig } from "@next/env";
import { asc, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { call, resolutionAttempt } from "@/db/schema";
import type { ResolutionCandidate } from "@/lib/batphone/state";

const USAGE = `Usage: npm run resolution:report [-- --since <ISO date>]

Prints every resolution attempt across all calls as a table.

Options:
  --since <ISO date>  Only calls received at or after this date or date-time
                      (for example 2026-09-01 or 2026-09-01T12:00:00Z).
  --help              Show this help.`;

const TOP_CANDIDATES = 3;
const MAX_TEXT_WIDTH = 40;
const MAX_CANDIDATES_WIDTH = 60;

interface Options {
  since?: Date;
}

function parseArgs(argv: readonly string[]): Options | "help" {
  const options: Options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      return "help";
    }
    if (arg === "--since") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--since needs an ISO date, for example 2026-09-01");
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`--since value "${value}" is not an ISO date`);
      }
      options.since = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument "${arg}"\n\n${USAGE}`);
  }
  return options;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function formatConfidence(confidence: number | null): string {
  if (confidence === null) return "-";
  return `${Math.round(confidence * 100)}%`;
}

function formatCandidates(candidates: readonly ResolutionCandidate[]): string {
  if (candidates.length === 0) return "-";
  return candidates
    .slice(0, TOP_CANDIDATES)
    .map((candidate) => `${candidate.name} ${candidate.score.toFixed(2)}`)
    .join("; ");
}

function renderTable(headers: readonly string[], rows: readonly string[][]) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0))
  );
  const line = (cells: readonly string[]) =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ");
  const rule = widths.map((width) => "-".repeat(width)).join("  ");
  console.log(line(headers));
  console.log(rule);
  for (const row of rows) {
    console.log(line(row));
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    console.log(USAGE);
    return;
  }

  // Load .env.local (and other .env files) the same way Next.js does, only
  // once a database is actually needed.
  loadEnvConfig(process.cwd());

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is not set. Add it to .env.local or export it in your shell."
    );
    process.exit(1);
  }

  const connection = postgres(databaseUrl, { max: 1 });
  const db = drizzle(connection);

  try {
    const attempts = await db
      .select({
        createdAt: resolutionAttempt.createdAt,
        attemptNumber: resolutionAttempt.attemptNumber,
        inputKind: resolutionAttempt.inputKind,
        heardText: resolutionAttempt.heardText,
        confidence: resolutionAttempt.confidence,
        candidates: resolutionAttempt.candidates,
        decision: resolutionAttempt.decision,
        callerResponse: resolutionAttempt.callerResponse,
      })
      .from(resolutionAttempt)
      .innerJoin(call, eq(resolutionAttempt.callId, call.id))
      .where(parsed.since ? gte(call.inboundAt, parsed.since) : undefined)
      .orderBy(asc(call.inboundAt), asc(resolutionAttempt.attemptNumber));

    if (attempts.length === 0) {
      console.log("No attempts recorded");
      return;
    }

    const rows = attempts.map((attempt) => [
      attempt.createdAt.toISOString(),
      String(attempt.attemptNumber),
      attempt.inputKind,
      truncate(attempt.heardText, MAX_TEXT_WIDTH),
      formatConfidence(attempt.confidence),
      truncate(formatCandidates(attempt.candidates), MAX_CANDIDATES_WIDTH),
      attempt.decision,
      attempt.callerResponse ?? "-",
    ]);

    renderTable(
      [
        "Date",
        "#",
        "Input",
        "Heard",
        "Conf",
        "Top candidates",
        "Decision",
        "Caller response",
      ],
      rows
    );
    console.log(
      `\n${attempts.length} attempt${attempts.length === 1 ? "" : "s"}` +
        (parsed.since ? ` since ${parsed.since.toISOString()}` : "")
    );
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`resolution:report failed: ${message}`);
  process.exit(1);
});
