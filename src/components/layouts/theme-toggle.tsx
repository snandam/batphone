"use client";

import { useSyncExternalStore, useState } from "react";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const [animating, setAnimating] = useState(false);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="relative h-11 w-11"
        aria-hidden
      >
        <Sun className="h-4 w-4 scale-100 dark:scale-0" />
        <Moon className="absolute h-4 w-4 scale-0 dark:scale-100" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    setAnimating(true);
    setTimeout(() => {
      setTheme(isDark ? "light" : "dark");
      setAnimating(false);
    }, 150);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative h-11 w-11 cursor-pointer"
      onClick={handleToggle}
      aria-label="Toggle theme"
    >
      <Sun
        className={`h-4 w-4 transition-transform duration-150 ${
          isDark || animating ? "scale-0 -rotate-90" : "scale-100 rotate-0"
        }`}
      />
      <Moon
        className={`absolute h-4 w-4 transition-transform duration-150 ${
          isDark && !animating ? "scale-100 rotate-0" : "scale-0 rotate-90"
        }`}
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
