import { describe, expect, it } from "vitest";

import {
  isValidSpeedDial,
  lowestFreeSpeedDial,
  normalizeContactName,
} from "./speed-dial";

describe("normalizeContactName", () => {
  it("lower-cases and collapses whitespace", () => {
    expect(normalizeContactName("  Mike   Anderson ")).toBe("mike anderson");
  });

  it("strips accents and punctuation", () => {
    expect(normalizeContactName("Zoë O'Brien-Smith")).toBe("zoe o brien smith");
  });

  it("treats case-only variants as the same name", () => {
    expect(normalizeContactName("MIKE")).toBe(normalizeContactName("mike"));
  });
});

describe("lowestFreeSpeedDial", () => {
  it("gives 1 when nothing is used", () => {
    expect(lowestFreeSpeedDial([])).toBe(1);
  });

  it("continues past a full run", () => {
    expect(lowestFreeSpeedDial([1, 2])).toBe(3);
  });

  it("fills the first gap, so a deleted code is handed out again", () => {
    expect(lowestFreeSpeedDial([1, 3])).toBe(2);
    expect(lowestFreeSpeedDial([2, 3])).toBe(1);
  });

  it("ignores order, duplicates, non-positive and non-integer values", () => {
    expect(lowestFreeSpeedDial([3, 1, 1, 2])).toBe(4);
    expect(lowestFreeSpeedDial([0, -1, 1.5])).toBe(1);
    expect(lowestFreeSpeedDial(new Set([0, 1]))).toBe(2);
  });
});

describe("isValidSpeedDial", () => {
  it("accepts whole numbers from 1 to 9999", () => {
    expect(isValidSpeedDial(1)).toBe(true);
    expect(isValidSpeedDial(9999)).toBe(true);
  });

  it("rejects zero, negatives, fractions, and anything past 9999", () => {
    expect(isValidSpeedDial(0)).toBe(false);
    expect(isValidSpeedDial(-1)).toBe(false);
    expect(isValidSpeedDial(2.5)).toBe(false);
    expect(isValidSpeedDial(10000)).toBe(false);
    expect(isValidSpeedDial(Number.NaN)).toBe(false);
  });
});
