import { describe, expect, it } from "vitest";

import { isSafePath, safePathOr } from "./safe-path";

describe("isSafePath", () => {
  it.each(["/", "/account", "/account/settings?tab=1", "/a#b"])(
    "accepts same-origin path %s",
    (value) => {
      expect(isSafePath(value)).toBe(true);
    }
  );

  it.each([
    "//evil.example/x",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "account",
    "",
    null,
    undefined,
  ])("rejects %s", (value) => {
    expect(isSafePath(value)).toBe(false);
  });
});

describe("safePathOr", () => {
  it("returns the path when safe", () => {
    expect(safePathOr("/account")).toBe("/account");
  });

  it("returns the fallback when unsafe", () => {
    expect(safePathOr("//evil.example")).toBe("/");
    expect(safePathOr(undefined, "/home")).toBe("/home");
  });
});
