"use client";

import { useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Poll cadence while a call shown on the page is still processing. */
const ACTIVE_INTERVAL_MS = 5_000;
/** Poll cadence while only watching for calls that are not on the page yet. */
const WATCH_INTERVAL_MS = 20_000;
/** Automatic updates stop after this long so an abandoned tab stays quiet. */
const UPDATE_WINDOW_MS = 10 * 60_000;

interface CallRefreshProps {
  /** A call on the page is still processing, so poll quickly for its progress. */
  active: boolean;
  /**
   * The page lists calls, so a new one can appear at any time: poll slowly
   * while idle and refresh whenever the caller comes back to the tab, which
   * is what happens after they dial from their phone.
   */
  watchForNewCalls?: boolean;
}

/** Refreshes server data only, never retries a provider operation. */
export function CallRefresh({
  active,
  watchForNewCalls = false,
}: CallRefreshProps) {
  return (
    <RefreshControl
      key={String(active)}
      active={active}
      watchForNewCalls={watchForNewCalls}
    />
  );
}

function RefreshControl({
  active,
  watchForNewCalls,
}: Required<CallRefreshProps>) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [pending, startTransition] = useTransition();
  const polling = active || watchForNewCalls;

  useEffect(() => {
    if (!polling) return;
    const deadline = Date.now() + UPDATE_WINDOW_MS;
    const refresh = () => {
      if (Date.now() >= deadline) {
        setPaused(true);
        clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") {
        startTransition(() => router.refresh());
      }
    };
    // Returning to a list is a fresh signal: refresh now and reopen the
    // update window even if it had expired while the tab was away.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (watchForNewCalls) {
        setPaused(false);
        setCycle((value) => value + 1);
        startTransition(() => router.refresh());
        return;
      }
      refresh();
    };
    const timer = setInterval(
      refresh,
      active ? ACTIVE_INTERVAL_MS : WATCH_INTERVAL_MS
    );
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, watchForNewCalls, polling, cycle, router]);

  const statusText = paused
    ? "Automatic updates paused. Refresh to check again."
    : active
      ? "Updates automatically while processing"
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {statusText && (
        <p className="text-muted-foreground text-xs" role="status">
          {statusText}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 cursor-pointer gap-2 text-sm"
        disabled={pending}
        onClick={() => {
          setPaused(false);
          setCycle((value) => value + 1);
          startTransition(() => router.refresh());
        }}
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
        {pending ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}
