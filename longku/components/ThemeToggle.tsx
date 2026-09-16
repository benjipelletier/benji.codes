"use client";

import { useEffect, useState } from "react";
import { applyTheme, nextTheme, readTheme, type Theme } from "@longku/lib/theme";

const GLYPH: Record<Theme, string> = { light: "☀", dark: "☾", system: "◐" };
const TITLE: Record<Theme, string> = {
  light: "Light — click for dark",
  dark: "Dark — click to follow system",
  system: "Following system — click for light",
};

export function ThemeToggle() {
  // Starts at "system" on both server and first client render so the markup
  // matches; the stored choice is adopted right after mount. The boot script
  // in the layout has already painted the correct ground by then.
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => setTheme(readTheme()), []);

  function cycle() {
    const next = nextTheme(theme);
    setTheme(next);
    applyTheme(next);
    // Let anything painting to canvas re-read the tokens.
    window.dispatchEvent(new CustomEvent("longku:themechange"));
  }

  return (
    <button
      type="button"
      className="longku-icon-btn"
      onClick={cycle}
      title={TITLE[theme]}
      aria-label={TITLE[theme]}
    >
      {GLYPH[theme]}
    </button>
  );
}
