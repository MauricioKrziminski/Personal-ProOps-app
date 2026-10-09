import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Mode = "light" | "dark";
const KEY = "proops-admin-theme";
const ThemeCtx = createContext<{ mode: Mode; toggle: () => void }>({ mode: "light", toggle: () => {} });

const initial = (): Mode => {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "dark" || s === "light") return s;
  } catch { /* storage bloqueado */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initial);
  useEffect(() => { document.documentElement.classList.toggle("dark", mode === "dark"); }, [mode]);
  const toggle = useCallback(() => {
    setMode((m) => {
      const n = m === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, n); } catch { /* ok */ }
      return n;
    });
  }, []);
  return <ThemeCtx.Provider value={{ mode, toggle }}>{children}</ThemeCtx.Provider>;
}
export const useTheme = () => useContext(ThemeCtx);
