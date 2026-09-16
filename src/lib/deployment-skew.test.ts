import { describe, expect, it, vi } from "vitest";

import {
  attemptDeploymentSkewReload,
  getDeploymentSkewReloadCount,
  incrementDeploymentSkewReloadCount,
  isServerActionSkewError,
  MAX_AUTO_RELOADS,
} from "@/lib/deployment-skew";

describe("deployment skew detection", () => {
  it("detects the server action mismatch message", () => {
    const error = new Error(
      "Failed to find Server Action 123. This request might be from an older or newer deployment."
    );

    expect(isServerActionSkewError(error)).toBe(true);
  });

  it("detects module-not-found messages", () => {
    const error = new Error("Could not find the module for action xyz");

    expect(isServerActionSkewError(error)).toBe(true);
  });

  it("does not treat generic server action wording as deployment skew", () => {
    const error = new Error("Server action validation failed");

    expect(isServerActionSkewError(error)).toBe(false);
  });

  it("does not treat regular 404s as deployment skew", () => {
    const error = Object.assign(new Error("Not found"), {
      digest: "NEXT_NOT_FOUND",
    });

    expect(isServerActionSkewError(error)).toBe(false);
  });
});

describe("deployment skew reload tracking", () => {
  it("increments the counter while storage is available", () => {
    const storage = window.sessionStorage;
    storage.clear();

    expect(getDeploymentSkewReloadCount(storage)).toBe(0);
    expect(incrementDeploymentSkewReloadCount(storage)).toBe(1);
    expect(getDeploymentSkewReloadCount(storage)).toBe(1);
  });

  it("disables auto-reload when storage is unavailable", () => {
    expect(getDeploymentSkewReloadCount(null)).toBeNull();
    expect(incrementDeploymentSkewReloadCount(null)).toBeNull();
  });

  it("reloads when within the retry budget", () => {
    const storage = window.sessionStorage;
    const reload = vi.fn();
    storage.clear();

    expect(attemptDeploymentSkewReload({ storage, reload })).toBe("reloaded");
    expect(reload).toHaveBeenCalledOnce();
    expect(getDeploymentSkewReloadCount(storage)).toBe(1);
  });

  it("does not reload when the retry budget is exhausted", () => {
    const storage = window.sessionStorage;
    const reload = vi.fn();
    storage.clear();

    for (let i = 0; i < MAX_AUTO_RELOADS; i += 1) {
      incrementDeploymentSkewReloadCount(storage);
    }

    expect(attemptDeploymentSkewReload({ storage, reload })).toBe(
      "manual_refresh"
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
