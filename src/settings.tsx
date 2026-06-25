// 应用级设置（主题 + 字号），单一 store，localStorage 键 rc:settings。
// 主题在这里解析并落到 <html data-theme>，字号落到 <html data-font>；index.html 的内联脚本
// 保证首屏前已应用，避免 FOUC。语言仍由 i18n.tsx 独立管理。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "system" | "dark" | "light";
export type FontScale = "sm" | "md" | "lg";

export interface AppSettings {
  theme: Theme;
  fontScale: FontScale;
}

interface SettingsCtx extends AppSettings {
  setTheme: (t: Theme) => void;
  setFontScale: (f: FontScale) => void;
  /** 实际生效的主题（system 已按系统偏好解析为 dark/light）。 */
  resolvedTheme: "dark" | "light";
}

const DEFAULTS: AppSettings = { theme: "system", fontScale: "md" };
const KEY = "rc:settings";

const Ctx = createContext<SettingsCtx | null>(null);

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw);
    return {
      theme:
        p.theme === "light" || p.theme === "dark" || p.theme === "system"
          ? p.theme
          : DEFAULTS.theme,
      fontScale:
        p.fontScale === "sm" || p.fontScale === "md" || p.fontScale === "lg"
          ? p.fontScale
          : DEFAULTS.fontScale,
    };
  } catch {
    return DEFAULTS;
  }
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    return false;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(load);
  const [sysLight, setSysLight] = useState<boolean>(systemPrefersLight);

  // 跟随系统偏好变化（仅当 theme==="system" 时影响 resolvedTheme）。
  useEffect(() => {
    const mql =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: light)")
        : null;
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent) => setSysLight(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // 持久化。
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const resolvedTheme: "dark" | "light" =
    settings.theme === "system" ? (sysLight ? "light" : "dark") : settings.theme;

  // 应用到 <html>。
  useEffect(() => {
    const d = document.documentElement;
    d.setAttribute("data-theme", resolvedTheme);
    d.setAttribute("data-font", settings.fontScale);
  }, [resolvedTheme, settings.fontScale]);

  const setTheme = useCallback(
    (t: Theme) => setSettings((s) => ({ ...s, theme: t })),
    [],
  );
  const setFontScale = useCallback(
    (f: FontScale) => setSettings((s) => ({ ...s, fontScale: f })),
    [],
  );

  return (
    <Ctx.Provider
      value={{ ...settings, setTheme, setFontScale, resolvedTheme }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings 必须在 <SettingsProvider> 内使用");
  return ctx;
}
