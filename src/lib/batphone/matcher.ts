/**
 * Contact matcher
 *
 * Resolves what the caller said (or typed) to one of their contacts. Pure
 * module: no I/O, no Next.js or database imports, so the whole decision is
 * unit-testable against a table of speech samples.
 *
 * Pipeline for speech (R8):
 * 1. Normalise the query and every contact name: lower-case, strip
 *    punctuation, collapse whitespace, drop leading command words.
 * 2. An exact normalised match wins outright.
 * 3. Otherwise score every contact: for each query token the best of
 *    Jaro-Winkler against each contact token, 1.0 on Double Metaphone
 *    equality, or 1.0 on nickname equivalence. The contact score is the
 *    mean of those per-token bests plus a small bonus when every query token
 *    hit a distinct contact token. When that falls short of a match, the
 *    space-stripped query is re-segmented into as many parts as the contact
 *    has tokens and the best split is scored part by part, so a result with
 *    a shifted word boundary such as "my canderson" still reaches
 *    "mike anderson" ("myc" sounds like "mike").
 * 4. Thresholds: match when the top score is at least MATCH_THRESHOLD and
 *    leads the runner-up by MATCH_MARGIN; ambiguous when two or more score
 *    at least AMBIGUOUS_THRESHOLD; otherwise none.
 * 5. R27: when the result would be ambiguous but every candidate at or
 *    above AMBIGUOUS_THRESHOLD dials the same number, the highest-scoring
 *    one is a match, since asking would not change who is called.
 */

import { doubleMetaphone } from "double-metaphone";

import { areNicknames } from "./nicknames";
import { normalizeContactName } from "./speed-dial";

import type { ResolutionCandidate } from "./state";

export const MATCH_THRESHOLD = 0.85;
export const MATCH_MARGIN = 0.15;
export const AMBIGUOUS_THRESHOLD = 0.7;
/** Added when every query token hit a distinct contact token. */
export const ALL_TOKENS_BONUS = 0.05;
/** Candidates reported and, when ambiguous, read out. */
export const MAX_CANDIDATES = 4;

/** Leading phrases a caller adds around a name. Longest first so "can you call" wins over "call". */
const COMMAND_PREFIXES = [
  "can you please call",
  "could you please call",
  "please can you call",
  "can you call",
  "could you call",
  "would you call",
  "please call",
  "please dial",
  "please phone",
  "please ring",
  "get me",
  "call",
  "dial",
  "phone",
  "ring",
  "please",
];

/** Trailing filler such as "call mike please". */
const COMMAND_SUFFIXES = ["please", "now"];

export interface MatchableContact {
  id: string;
  name: string;
  /** E.164. */
  phone: string;
  speedDial: number;
}

/** A candidate as stored on the resolution attempt, plus the number for R27. */
export type ScoredCandidate = ResolutionCandidate & { phone: string };

export type ResolveResult<C extends MatchableContact = MatchableContact> =
  | { kind: "match"; contact: C; score: number; candidates: ScoredCandidate[] }
  | {
      kind: "ambiguous";
      candidates: ScoredCandidate[];
      /** The close candidates (at or above the ambiguous threshold) to read out. */
      options: ScoredCandidate[];
    }
  | { kind: "none"; candidates: ScoredCandidate[] };

export interface ResolveOptions {
  matchThreshold?: number;
  matchMargin?: number;
  ambiguousThreshold?: number;
}

/**
 * Jaro-Winkler similarity in [0, 1]. Standard parameters: prefix scale 0.1
 * over at most four leading characters. Empty input scores 0.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;

  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Normalise a spoken query: lower-case, punctuation stripped, whitespace
 * collapsed, and leading command words ("call", "get me", "can you call")
 * and trailing filler ("please") removed.
 */
export function normalizeQuery(query: string): string {
  let text = normalizeContactName(query);
  for (const prefix of COMMAND_PREFIXES) {
    if (text === prefix) return "";
    if (text.startsWith(`${prefix} `)) {
      text = text.slice(prefix.length + 1);
      break;
    }
  }
  for (const suffix of COMMAND_SUFFIXES) {
    if (text.endsWith(` ${suffix}`)) {
      text = text.slice(0, -(suffix.length + 1));
    }
  }
  return text.trim();
}

function tokens(text: string): string[] {
  return text.split(" ").filter((token) => token.length > 0);
}

const metaphoneCache = new Map<string, string[]>();

/** Primary and alternate Double Metaphone codes, empty codes dropped. */
function metaphoneCodes(word: string): string[] {
  const cached = metaphoneCache.get(word);
  if (cached) return cached;
  const codes = doubleMetaphone(word).filter((code) => code.length > 0);
  if (metaphoneCache.size > 10_000) metaphoneCache.clear();
  metaphoneCache.set(word, codes);
  return codes;
}

function phoneticallyEqual(a: string, b: string): boolean {
  const codesB = metaphoneCodes(b);
  return metaphoneCodes(a).some((code) => codesB.includes(code));
}

/** Similarity of one query token to one contact token. */
function tokenScore(queryToken: string, contactToken: string): number {
  if (queryToken === contactToken) return 1;
  if (areNicknames(queryToken, contactToken)) return 1;
  if (phoneticallyEqual(queryToken, contactToken)) return 1;
  return jaroWinkler(queryToken, contactToken);
}

/** Score in [0, 1] of a normalised query against one normalised contact name. */
function scoreContact(queryTokens: string[], contactName: string): number {
  const contactTokens = tokens(contactName);
  if (queryTokens.length === 0 || contactTokens.length === 0) return 0;

  const hit = new Set<number>();
  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    let bestIndex = -1;
    contactTokens.forEach((contactToken, index) => {
      const score = tokenScore(queryToken, contactToken);
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    });
    total += best;
    if (bestIndex >= 0 && best > 0) hit.add(bestIndex);
  }
  const mean = total / queryTokens.length;
  const allDistinct = hit.size === queryTokens.length;
  let score = allDistinct ? mean + ALL_TOKENS_BONUS : mean;

  if (score < MATCH_THRESHOLD && queryTokens.length > 1) {
    score = Math.max(
      score,
      bestSegmentation(queryTokens.join(""), contactTokens) + ALL_TOKENS_BONUS
    );
  }
  return Math.min(1, score);
}

/** Longest space-stripped query the re-segmentation step will try. */
const MAX_SEGMENTATION_LENGTH = 32;
/** Contact names with more tokens than this are not re-segmented. */
const MAX_SEGMENTATION_TOKENS = 3;

/**
 * Best mean score over every way of cutting `joined` into
 * `contactTokens.length` non-empty parts, part i scored against contact
 * token i. Repairs speech results whose word boundary landed in the wrong
 * place. Returns 0 when the input is outside the bounded search.
 */
function bestSegmentation(joined: string, contactTokens: string[]): number {
  const parts = contactTokens.length;
  if (
    parts < 2 ||
    parts > MAX_SEGMENTATION_TOKENS ||
    joined.length < parts ||
    joined.length > MAX_SEGMENTATION_LENGTH
  ) {
    return 0;
  }
  let best = 0;
  const walk = (start: number, index: number, total: number) => {
    if (index === parts - 1) {
      const last = tokenScore(joined.slice(start), contactTokens[index] ?? "");
      best = Math.max(best, (total + last) / parts);
      return;
    }
    const remaining = parts - index - 1;
    for (let end = start + 1; end <= joined.length - remaining; end++) {
      const score = tokenScore(
        joined.slice(start, end),
        contactTokens[index] ?? ""
      );
      walk(end, index + 1, total + score);
    }
  };
  walk(0, 0, 0);
  return best;
}

function candidateOf(
  contact: MatchableContact,
  score: number
): ScoredCandidate {
  return {
    contactId: contact.id,
    name: contact.name,
    phone: contact.phone,
    score: Math.round(score * 1000) / 1000,
  };
}

/**
 * Resolve a spoken query against the caller's contacts. Candidates are
 * always returned in rank order (at most MAX_CANDIDATES) so the attempt
 * can be stored and explained even when nothing matched; an ambiguous
 * result also carries the close candidates as the options to read out.
 */
export function resolveContact<C extends MatchableContact>(
  query: string,
  contacts: readonly C[],
  opts: ResolveOptions = {}
): ResolveResult<C> {
  const matchThreshold = opts.matchThreshold ?? MATCH_THRESHOLD;
  const matchMargin = opts.matchMargin ?? MATCH_MARGIN;
  const ambiguousThreshold = opts.ambiguousThreshold ?? AMBIGUOUS_THRESHOLD;

  const normalized = normalizeQuery(query);
  if (normalized.length === 0) return { kind: "none", candidates: [] };

  const exact = contacts.find(
    (contact) => normalizeContactName(contact.name) === normalized
  );
  if (exact) {
    return {
      kind: "match",
      contact: exact,
      score: 1,
      candidates: [candidateOf(exact, 1)],
    };
  }

  const queryTokens = tokens(normalized);
  const scored = contacts
    .map((contact, index) => ({
      contact,
      index,
      score: scoreContact(queryTokens, normalizeContactName(contact.name)),
    }))
    .filter((entry) => entry.score > 0)
    // Stable: ties keep contact-list (speed-dial) order.
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const candidates = scored
    .slice(0, MAX_CANDIDATES)
    .map((entry) => candidateOf(entry.contact, entry.score));

  const top = scored[0];
  if (!top) return { kind: "none", candidates };
  const second = scored[1];

  const isMatch =
    top.score >= matchThreshold &&
    (!second || top.score - second.score >= matchMargin);
  if (isMatch) {
    return {
      kind: "match",
      contact: top.contact,
      score: top.score,
      candidates,
    };
  }

  const close = scored.filter((entry) => entry.score >= ambiguousThreshold);
  if (close.length >= 2) {
    const sameNumber = close.every(
      (entry) => entry.contact.phone === top.contact.phone
    );
    if (sameNumber) {
      return {
        kind: "match",
        contact: top.contact,
        score: top.score,
        candidates,
      };
    }
    return {
      kind: "ambiguous",
      candidates,
      options: close
        .slice(0, MAX_CANDIDATES)
        .map((entry) => candidateOf(entry.contact, entry.score)),
    };
  }

  return { kind: "none", candidates };
}

/**
 * Keypad path (R5): the digits Twilio collected, with the finish key and
 * whitespace ignored, looked up as a speed-dial code. Non-numeric input or
 * an unknown code is none.
 */
export function resolveBySpeedDial<C extends MatchableContact>(
  digits: string,
  contacts: readonly C[]
): ResolveResult<C> {
  const cleaned = digits.replace(/[#*\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return { kind: "none", candidates: [] };
  const code = Number.parseInt(cleaned, 10);
  const contact = contacts.find((entry) => entry.speedDial === code);
  if (!contact) return { kind: "none", candidates: [] };
  return {
    kind: "match",
    contact,
    score: 1,
    candidates: [candidateOf(contact, 1)],
  };
}
