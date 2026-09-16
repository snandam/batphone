import { describe, expect, it } from "vitest";

import { liveCallPhase } from "./call-progress";

describe("liveCallPhase", () => {
  it("stops calling a call live when the hang-up callback arrives before the recording callback", () => {
    expect(liveCallPhase([{ status: "dialing", endedAt: new Date() }])).toBe(
      "processing"
    );
  });
  it("still prioritizes another call that is actually active", () => {
    expect(
      liveCallPhase([
        { status: "dialing", endedAt: new Date() },
        { status: "dialing", endedAt: null },
      ])
    ).toBe("in_call");
  });
  it("clears the badge once processing finishes", () => {
    expect(
      liveCallPhase([{ status: "emailed", endedAt: new Date() }])
    ).toBeNull();
  });
});
