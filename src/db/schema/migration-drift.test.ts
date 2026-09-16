/**
 * Migration Drift Detection
 *
 * Guards the recurring production incident class: schema files changed but
 * `drizzle-kit generate` not run ("column X does not exist" at runtime), and
 * a `_journal.json` whose `when` values are not monotonically increasing,
 * which makes drizzle-kit silently skip migrations (drizzle orders by `when`,
 * not `idx`).
 *
 * Compares the Drizzle TypeScript schema against the latest migration
 * snapshot in ./drizzle and checks the journal's integrity.
 */

import fs from "fs";
import path from "path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, it, expect } from "vitest";

import * as schema from "./index";

const DRIZZLE_DIR = path.resolve(__dirname, "../../../drizzle");
const META_DIR = path.join(DRIZZLE_DIR, "meta");

function getJournal(): {
  entries: { idx: number; when: number; tag: string }[];
} {
  return JSON.parse(
    fs.readFileSync(path.join(META_DIR, "_journal.json"), "utf-8")
  );
}

function getLatestSnapshot(): Record<string, unknown> {
  const journal = getJournal();
  const lastEntry = journal.entries[journal.entries.length - 1]!;
  const snapshotPath = path.join(
    META_DIR,
    `${String(lastEntry.idx).padStart(4, "0")}_snapshot.json`
  );
  return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
}

/** Extract all pgTable objects from the schema exports */
function getSchemaTables() {
  const tables: { name: string; columns: string[] }[] = [];
  for (const value of Object.values(schema)) {
    try {
      const config = getTableConfig(value as never);
      if (config?.name) {
        tables.push({
          name: config.name,
          columns: config.columns.map((c) => c.name),
        });
      }
    } catch {
      // Not a table, skip
    }
  }
  return tables;
}

/** Extract all pgEnum objects from the schema exports */
function getSchemaEnums() {
  const enums: { name: string; values: string[] }[] = [];
  // `unknown` on purpose: when the schema has no enums, TypeScript narrows
  // the exports to a union with no callable member and the guard below
  // collapses to `never`, which fails type-check. The runtime check is the
  // same either way.
  for (const value of Object.values(schema) as unknown[]) {
    if (
      value &&
      typeof value === "function" &&
      "enumName" in value &&
      "enumValues" in value
    ) {
      enums.push({
        name: value.enumName as string,
        values: [...(value.enumValues as string[])],
      });
    }
  }
  return enums;
}

describe("Migration drift detection", () => {
  it("has a committed migrations directory", () => {
    expect(
      fs.existsSync(path.join(META_DIR, "_journal.json")),
      'No drizzle/meta/_journal.json. Run "npm run db:generate" and commit the drizzle/ directory.'
    ).toBe(true);
  });

  it("every schema table exists in the latest snapshot", () => {
    const snapshot = getLatestSnapshot();
    const snapshotTables = snapshot.tables as Record<
      string,
      { name: string; columns: Record<string, { name: string }> }
    >;
    const missing = getSchemaTables()
      .filter((table) => !snapshotTables[`public.${table.name}`])
      .map((table) => table.name);

    expect(
      missing,
      [
        "Tables defined in schema but missing from latest migration snapshot.",
        `Missing: ${missing.join(", ")}`,
        'Fix: run "npm run db:generate" and commit the output.',
      ].join("\n")
    ).toEqual([]);
  });

  it("every schema column exists in the latest snapshot", () => {
    const snapshot = getLatestSnapshot();
    const snapshotTables = snapshot.tables as Record<
      string,
      { name: string; columns: Record<string, { name: string }> }
    >;
    const missing: string[] = [];

    for (const table of getSchemaTables()) {
      const snapshotTable = snapshotTables[`public.${table.name}`];
      if (!snapshotTable) continue; // Covered by table-level test

      const snapshotColumns = new Set(
        Object.values(snapshotTable.columns).map((c) => c.name)
      );
      for (const col of table.columns) {
        if (!snapshotColumns.has(col)) {
          missing.push(`${table.name}.${col}`);
        }
      }
    }

    expect(
      missing,
      [
        "Columns defined in schema but missing from latest migration snapshot.",
        `Missing: ${missing.join(", ")}`,
        'Fix: run "npm run db:generate" and commit the output.',
      ].join("\n")
    ).toEqual([]);
  });

  it("every schema enum exists in the latest snapshot", () => {
    const snapshot = getLatestSnapshot();
    const snapshotEnums = snapshot.enums as Record<
      string,
      { name: string; values: string[] }
    >;
    const missing = getSchemaEnums()
      .filter((e) => !snapshotEnums[`public.${e.name}`])
      .map((e) => e.name);

    expect(
      missing,
      [
        "Enums defined in schema but missing from latest migration snapshot.",
        `Missing: ${missing.join(", ")}`,
        'Fix: run "npm run db:generate" and commit the output.',
      ].join("\n")
    ).toEqual([]);
  });

  it("journal timestamps are monotonically increasing", () => {
    const journal = getJournal();
    const outOfOrder: string[] = [];

    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1]!;
      const curr = journal.entries[i]!;
      if (curr.when <= prev.when) {
        outOfOrder.push(
          `${curr.tag} (when=${curr.when}) <= ${prev.tag} (when=${prev.when})`
        );
      }
    }

    expect(
      outOfOrder,
      [
        "Journal timestamps are out of order. drizzle-kit orders migrations by",
        "'when', not 'idx', and silently skips entries that sort before an",
        "already-applied one. Bump 'when' above the previous entry.",
        `Out of order: ${outOfOrder.join("; ")}`,
      ].join("\n")
    ).toEqual([]);
  });

  it("every journal entry has a corresponding SQL file", () => {
    const missingSql = getJournal()
      .entries.filter(
        (entry) => !fs.existsSync(path.join(DRIZZLE_DIR, `${entry.tag}.sql`))
      )
      .map((entry) => entry.tag);

    expect(missingSql, `Missing SQL files: ${missingSql.join(", ")}`).toEqual(
      []
    );
  });
});
