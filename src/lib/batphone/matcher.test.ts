import { describe, expect, it } from "vitest";

import {
  jaroWinkler,
  normalizeQuery,
  resolveBySpeedDial,
  resolveContact,
  type MatchableContact,
} from "./matcher";

const MIKE_ANDERSON: MatchableContact = {
  id: "c-anderson",
  name: "Mike Anderson",
  phone: "+15551234567",
  speedDial: 1,
};
const SARAH_CHEN: MatchableContact = {
  id: "c-chen",
  name: "Sarah Chen",
  phone: "+15552222222",
  speedDial: 2,
};
const MIKE_BROWN: MatchableContact = {
  id: "c-brown",
  name: "Mike Brown",
  phone: "+15553333333",
  speedDial: 3,
};
const ROBERT_JONES: MatchableContact = {
  id: "c-jones",
  name: "Robert Jones",
  phone: "+15554444444",
  speedDial: 4,
};
/** Shares Mike Anderson's number (R27 / AE13). */
const MIKE_WORK: MatchableContact = {
  id: "c-mike-work",
  name: "Mike (work)",
  phone: MIKE_ANDERSON.phone,
  speedDial: 5,
};

const CONTACTS = [MIKE_ANDERSON, SARAH_CHEN, MIKE_BROWN, ROBERT_JONES];

describe("jaroWinkler", () => {
  it("returns 1 for identical strings and 0 for empty or disjoint ones", () => {
    expect(jaroWinkler("anderson", "anderson")).toBe(1);
    expect(jaroWinkler("", "anderson")).toBe(0);
    expect(jaroWinkler("", "")).toBe(0);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("matches the reference values for the classic examples", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 2);
    expect(jaroWinkler("dixon", "dicksonx")).toBeCloseTo(0.8133, 3);
  });

  it("is symmetric and rewards a shared prefix", () => {
    expect(jaroWinkler("sara", "sarah")).toBe(jaroWinkler("sarah", "sara"));
    expect(jaroWinkler("sara", "sarah")).toBeGreaterThan(0.9);
    expect(jaroWinkler("canderson", "anderson")).toBeGreaterThan(0.9);
  });
});

describe("normalizeQuery", () => {
  it("lower-cases, strips punctuation, collapses whitespace, and drops command words", () => {
    expect(normalizeQuery("  Call   Mike Anderson, please! ")).toBe(
      "mike anderson"
    );
    expect(normalizeQuery("Can you call Sarah Chen")).toBe("sarah chen");
    expect(normalizeQuery("get me bob")).toBe("bob");
    expect(normalizeQuery("dial")).toBe("");
  });
});

describe("resolveContact table", () => {
  const table: {
    query: string;
    kind: "match" | "ambiguous" | "none";
    top?: string;
    note?: string;
  }[] = [
    { query: "mike anderson", kind: "match", top: MIKE_ANDERSON.id },
    { query: "call mike anderson", kind: "match", top: MIKE_ANDERSON.id },
    { query: "michael anderson", kind: "match", top: MIKE_ANDERSON.id },
    { query: "mike", kind: "ambiguous", note: "Anderson vs Brown" },
    { query: "anderson", kind: "match", top: MIKE_ANDERSON.id },
    { query: "my canderson", kind: "match", top: MIKE_ANDERSON.id },
    { query: "sara chen", kind: "match", top: SARAH_CHEN.id },
    { query: "sarah", kind: "match", top: SARAH_CHEN.id },
    { query: "bob", kind: "match", top: ROBERT_JONES.id },
    { query: "nobody here", kind: "none" },
    { query: "", kind: "none" },
  ];

  for (const row of table) {
    it(`"${row.query}" -> ${row.kind}${row.top ? ` ${row.top}` : ""}`, () => {
      const result = resolveContact(row.query, CONTACTS);
      expect(result.kind).toBe(row.kind);
      if (row.kind === "match" && result.kind === "match") {
        expect(result.contact.id).toBe(row.top);
        expect(result.candidates[0]?.contactId).toBe(row.top);
      }
    });
  }

  it("mike is ambiguous between Mike Anderson and Mike Brown, in that order, with only the close candidates as options", () => {
    const result = resolveContact("mike", CONTACTS);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.options.map((c) => c.contactId)).toEqual([
      MIKE_ANDERSON.id,
      MIKE_BROWN.id,
    ]);
    // The stored candidate list still carries the low scorers for R26.
    expect(result.candidates.length).toBeGreaterThan(result.options.length);
    expect(result.candidates.slice(0, 2)).toEqual(result.options);
  });

  it("returns candidates ordered by score with name, phone, and score, capped at four", () => {
    const many = [
      ...CONTACTS,
      MIKE_WORK,
      { id: "c-6", name: "Mia Andrews", phone: "+15556666666", speedDial: 6 },
    ];
    const result = resolveContact("mike anderson", many);
    expect(result.candidates.length).toBeLessThanOrEqual(4);
    expect(result.candidates[0]).toEqual({
      contactId: MIKE_ANDERSON.id,
      name: MIKE_ANDERSON.name,
      phone: MIKE_ANDERSON.phone,
      score: expect.any(Number),
    });
    const scores = result.candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("an empty query has no candidates", () => {
    const result = resolveContact("", CONTACTS);
    expect(result).toEqual({ kind: "none", candidates: [] });
  });

  it("a match reports its score and the full candidate list (AE12)", () => {
    const result = resolveContact("my canderson", [MIKE_ANDERSON, SARAH_CHEN]);
    expect(result.kind).toBe("match");
    if (result.kind !== "match") return;
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.candidates.map((c) => c.contactId)).toEqual([
      MIKE_ANDERSON.id,
      SARAH_CHEN.id,
    ]);
  });
});

describe("resolveContact with shared numbers (R27, AE13)", () => {
  it("two Mikes on the same number resolve to a match for the higher-scoring one", () => {
    const result = resolveContact("mike", [MIKE_ANDERSON, MIKE_WORK]);
    expect(result.kind).toBe("match");
    if (result.kind !== "match") return;
    expect(result.contact.id).toBe(MIKE_ANDERSON.id);
    expect(result.contact.phone).toBe(MIKE_WORK.phone);
  });

  it("three Mikes where only two share a number still disambiguate", () => {
    const result = resolveContact("mike", [
      MIKE_ANDERSON,
      MIKE_WORK,
      MIKE_BROWN,
    ]);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.options.map((c) => c.contactId)).toEqual([
      MIKE_ANDERSON.id,
      MIKE_WORK.id,
      MIKE_BROWN.id,
    ]);
  });
});

describe("resolveBySpeedDial", () => {
  it("returns a match for an existing code and none otherwise", () => {
    const hit = resolveBySpeedDial("2", CONTACTS);
    expect(hit.kind).toBe("match");
    if (hit.kind === "match") {
      expect(hit.contact.id).toBe(SARAH_CHEN.id);
      expect(hit.score).toBe(1);
      expect(hit.candidates).toEqual([
        {
          contactId: SARAH_CHEN.id,
          name: SARAH_CHEN.name,
          phone: SARAH_CHEN.phone,
          score: 1,
        },
      ]);
    }
    expect(resolveBySpeedDial("9", CONTACTS)).toEqual({
      kind: "none",
      candidates: [],
    });
  });

  it("ignores the finish key, whitespace, and leading zeros but rejects non-numeric input", () => {
    expect(resolveBySpeedDial("02#", CONTACTS).kind).toBe("match");
    expect(resolveBySpeedDial(" 2 ", CONTACTS).kind).toBe("match");
    expect(resolveBySpeedDial("", CONTACTS).kind).toBe("none");
    expect(resolveBySpeedDial("*", CONTACTS).kind).toBe("none");
    expect(resolveBySpeedDial("2a", CONTACTS).kind).toBe("none");
  });
});
