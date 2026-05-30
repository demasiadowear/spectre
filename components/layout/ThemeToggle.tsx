"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Persistent light/dark toggle. Theme lives in a cookie (read server-side
// in the root layout → no flash). Default LIGHT.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-header-muted/40 text-header-muted transition-colors hover:border-header-accent hover:text-header-accent"
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5" strokeWidth={1.6} />
      ) : (
        <Moon className="h-3.5 w-3.5" strokeWidth={1.6} />
      )}
    </button>
  );
}
