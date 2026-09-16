// Theme selection, persisted per browser.
//
// Three states, not two: "system" is a real choice and the default, so the page
// follows the OS until the user says otherwise. "system" stamps no attribute,
// leaving the prefers-color-scheme rules in the stylesheet to decide.

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "longku:theme";

/** Inlined into <head> so the ground is correct before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); fall through.
  }
  return "system";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Persistence is a nicety; the attribute is already applied.
  }
}

/** light → dark → system → light */
export function nextTheme(t: Theme): Theme {
  return t === "light" ? "dark" : t === "dark" ? "system" : "light";
}

/** True when the given selection currently renders dark. */
export function resolvesDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
