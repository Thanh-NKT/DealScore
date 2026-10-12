"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

const STORAGE_KEY = "dealscore-theme";

type Theme = "light" | "dark";

function resolveCurrentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// The theme lives on <html data-theme>; re-render whenever that attribute or the OS preference changes.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

// Server render (and hydration) assume light, matching the pre-mount output.
const getServerTheme = (): Theme => "light";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, resolveCurrentTheme, getServerTheme);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors in private mode
    }
  };

  const isDark = theme === "dark";
  const label = isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="flex size-10 items-center justify-center rounded-full max-[440px]:size-9 text-ink-2 transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink cursor-pointer"
    >
      {isDark ? (
        <SunIcon className="size-[19px]" strokeWidth={1.9} />
      ) : (
        <MoonIcon className="size-[19px]" strokeWidth={1.9} />
      )}
    </button>
  );
}
