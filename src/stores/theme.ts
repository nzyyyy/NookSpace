import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";

const KEY = "nook-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function resolve(pref: ThemePreference): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolve(pref) === "dark");
  root.style.colorScheme = resolve(pref);
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  preference: (localStorage.getItem(KEY) as ThemePreference) || "system",
  setPreference: (pref) => {
    localStorage.setItem(KEY, pref);
    applyTheme(pref);
    set({ preference: pref });
  },
}));

// Called once at startup (and from main.tsx before paint via inline script).
export function initTheme() {
  const pref = (localStorage.getItem(KEY) as ThemePreference) || "system";
  applyTheme(pref);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    const current = (localStorage.getItem(KEY) as ThemePreference) || "system";
    applyTheme(current);
  });
  return pref;
}
