import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

const resolveDestination = vi.fn();
vi.mock("@/actions/user/onboarding", () => ({
  resolvePostLoginDestination: (...args: unknown[]) =>
    resolveDestination(...args),
}));

import AuthCallbackPage from "./page";

function setLocation(search: string, replace: () => void) {
  // jsdom's location.replace is not configurable directly — swap the object.
  Object.defineProperty(window, "location", {
    value: { ...window.location, search, replace },
    writable: true,
  });
}

/** Let the server-action promise settle inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AuthCallbackPage", () => {
  const locationReplace = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    routerReplace.mockClear();
    locationReplace.mockClear();
    resolveDestination.mockReset();
    resolveDestination.mockResolvedValue("/");
    setLocation("?next=%2Faccount", locationReplace);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("soft-navigates to an explicit safe next destination without asking the server", () => {
    render(<AuthCallbackPage />);
    expect(routerReplace).toHaveBeenCalledWith("/account");
    expect(resolveDestination).not.toHaveBeenCalled();
  });

  it("falls back to a hard navigation if the soft navigation never commits", () => {
    render(<AuthCallbackPage />);
    expect(locationReplace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2500);
    expect(locationReplace).toHaveBeenCalledWith("/account");
  });

  it("cancels the fallback when the page unmounts (navigation committed)", () => {
    const { unmount } = render(<AuthCallbackPage />);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(locationReplace).not.toHaveBeenCalled();
  });

  it("asks the server where to go when there is no next param", async () => {
    setLocation("", locationReplace);
    resolveDestination.mockResolvedValue("/setup");
    render(<AuthCallbackPage />);
    await flush();
    expect(resolveDestination).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith("/setup");
    vi.advanceTimersByTime(2500);
    expect(locationReplace).toHaveBeenCalledWith("/setup");
  });

  it("goes home when the server cannot be reached", async () => {
    setLocation("", locationReplace);
    resolveDestination.mockRejectedValue(new Error("offline"));
    render(<AuthCallbackPage />);
    await flush();
    expect(routerReplace).toHaveBeenCalledWith("/");
  });

  it("ignores an absolute next param", async () => {
    setLocation("?next=https%3A%2F%2Fevil.example", locationReplace);
    render(<AuthCallbackPage />);
    await flush();
    expect(routerReplace).toHaveBeenCalledWith("/");
    expect(routerReplace).not.toHaveBeenCalledWith("https://evil.example");
  });

  it("ignores a protocol-relative next param", async () => {
    setLocation("?next=%2F%2Fevil.example%2Fx", locationReplace);
    render(<AuthCallbackPage />);
    await flush();
    expect(routerReplace).toHaveBeenCalledWith("/");
    expect(routerReplace).not.toHaveBeenCalledWith("//evil.example/x");
  });

  it("does not navigate after unmounting while the server is still deciding", async () => {
    setLocation("", locationReplace);
    let resolve: (value: string) => void = () => {};
    resolveDestination.mockReturnValue(
      new Promise<string>((r) => {
        resolve = r;
      })
    );
    const { unmount } = render(<AuthCallbackPage />);
    unmount();
    resolve("/setup");
    await flush();
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
