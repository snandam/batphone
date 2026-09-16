import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { isCallProcessing } from "./call-progress";
import { CallRefresh } from "./call-refresh";

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("CallRefresh", () => {
  it("refreshes active calls but pauses requests while the tab is hidden", async () => {
    render(<CallRefresh active />);
    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await advance(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops when the server reports a terminal state and still allows manual refresh", async () => {
    const { rerender } = render(<CallRefresh active />);
    await advance(5_000);
    rerender(<CallRefresh active={false} />);
    await advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("cleans up both the timer and visibility listener on unmount", async () => {
    const { unmount } = render(<CallRefresh active />);
    await advance(5_000);
    unmount();
    await advance(20_000);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not poll a call that is already terminal on mount", async () => {
    render(<CallRefresh active={false} />);
    await advance(20_000);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("starts a fresh update window when new processing begins after a capped call", async () => {
    const { rerender } = render(<CallRefresh active />);
    await advance(10 * 60_000);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Automatic updates paused"
    );
    rerender(<CallRefresh active={false} />);
    rerender(<CallRefresh active />);
    const count = refresh.mock.calls.length;
    expect(screen.getByRole("status")).toHaveTextContent(
      "Updates automatically"
    );
    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(count + 1);
  });

  it("keeps the refresh budget bounded even when the tab stays hidden", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<CallRefresh active />);
    await advance(10 * 60_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Automatic updates paused"
    );
  });

  describe("watching a list for new calls", () => {
    it("polls slowly while nothing is processing, without a status line", async () => {
      render(<CallRefresh active={false} watchForNewCalls />);
      expect(screen.queryByRole("status")).toBeNull();
      await advance(19_000);
      expect(refresh).not.toHaveBeenCalled();
      await advance(1_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      await advance(20_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("polls quickly again once a listed call is processing", async () => {
      render(<CallRefresh active watchForNewCalls />);
      await advance(5_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Updates automatically while processing"
      );
    });

    it("refreshes as soon as the caller returns to the tab", async () => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      render(<CallRefresh active={false} watchForNewCalls />);
      await advance(60_000);
      expect(refresh).not.toHaveBeenCalled();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("pauses after ten minutes idle and resumes when the tab is shown again", async () => {
      render(<CallRefresh active={false} watchForNewCalls />);
      await advance(10 * 60_000);
      const count = refresh.mock.calls.length;
      expect(screen.getByRole("status")).toHaveTextContent(
        "Automatic updates paused"
      );
      await advance(60_000);
      expect(refresh).toHaveBeenCalledTimes(count);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(refresh).toHaveBeenCalledTimes(count + 1);
      expect(screen.queryByRole("status")).toBeNull();
      await advance(20_000);
      expect(refresh).toHaveBeenCalledTimes(count + 2);
    });
  });

  it("polls a saved transcript awaiting email but stops for a failure requiring recovery", async () => {
    const { rerender } = render(
      <CallRefresh active={isCallProcessing("transcribed")} />
    );
    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<CallRefresh active={isCallProcessing("email_failed")} />);
    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("caps automatic updates at ten minutes and lets the user restart them", async () => {
    render(<CallRefresh active />);
    await advance(10 * 60_000);
    const count = refresh.mock.calls.length;
    expect(screen.getByRole("status")).toHaveTextContent(
      "Automatic updates paused"
    );
    await advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(count);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(count + 2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Updates automatically"
    );
  });
});
