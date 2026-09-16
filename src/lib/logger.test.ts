// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger, redactValue } from "./logger";

const NUMBER = "+15551234567";
const MASKED = "+1*********67";

function lastLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error("nothing was logged");
  return JSON.parse(String(call[0])) as Record<string, unknown>;
}

describe("logger redaction", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("masks an E.164 number in a context value", () => {
    logger.info("call_received", { from: NUMBER });
    const line = lastLine(info);
    expect(line.from).toBe(MASKED);
    expect(JSON.stringify(line)).not.toContain(NUMBER);
  });

  it("masks an E.164 number embedded in a longer string", () => {
    logger.info("x", { note: `dialing ${NUMBER} now` });
    expect(lastLine(info).note).toBe(`dialing ${MASKED} now`);
  });

  it("masks numbers nested in objects and arrays", () => {
    logger.info("x", {
      nested: { numbers: [NUMBER, { deeper: NUMBER }] },
    });
    const line = lastLine(info);
    expect(line.nested).toEqual({
      numbers: [MASKED, { deeper: MASKED }],
    });
  });

  it("masks an E.164 number in an error message and stack", () => {
    logger.exception("boom", new Error(`lookup failed for ${NUMBER}`));
    const line = lastLine(error);
    expect(line.error_message).toBe(`lookup failed for ${MASKED}`);
    expect(String(line.error_stack)).not.toContain(NUMBER);
  });

  it("masks an E.164 number in a non-Error thrown value", () => {
    logger.exception("boom", `raw ${NUMBER}`);
    expect(lastLine(error).error_message).toBe(`raw ${MASKED}`);
  });

  it("truncates a 2000 character message", () => {
    const long = "x".repeat(2000);
    logger.info("x", { message: long });
    const written = String(lastLine(info).message);
    expect(written.length).toBeLessThan(600);
    expect(written.endsWith("…[truncated]")).toBe(true);
    expect(written.startsWith("x".repeat(500))).toBe(true);
  });

  it("truncates a long error message", () => {
    logger.exception("boom", new Error("y".repeat(2000)));
    const written = String(lastLine(error).error_message);
    expect(written.endsWith("…[truncated]")).toBe(true);
    expect(written.length).toBeLessThan(600);
  });

  it("leaves short strings, numbers, booleans, and nulls alone", () => {
    logger.info("x", { a: "hello", b: 3, c: true, d: null });
    const line = lastLine(info);
    expect(line).toMatchObject({ a: "hello", b: 3, c: true, d: null });
  });

  it("does not mask short digit runs that are not phone numbers", () => {
    expect(redactValue("+123 and +1234567")).toBe("+123 and +1*****67");
    expect(redactValue("order 12345678901")).toBe("order 12345678901");
  });

  it("serialises Date values as ISO strings", () => {
    const at = new Date("2026-09-11T00:00:00.000Z");
    logger.info("x", { at });
    expect(lastLine(info).at).toBe("2026-09-11T00:00:00.000Z");
  });
});
