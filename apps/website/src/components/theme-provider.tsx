import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = Exclude<Theme, "system">;

type ThemeProviderProps = {
  attribute?: string;
  children: ReactNode;
  defaultTheme?: Theme;
  disableTransitionOnChange?: boolean;
  enableSystem?: boolean;
  storageKey?: string;
};

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  systemTheme: ResolvedTheme;
  theme: Theme;
};

const themeStorageKey = "underwritten.theme";
const themeQuery = "(prefers-color-scheme: dark)";
const themeNames = new Set<Theme>(["light", "dark", "system"]);
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(themeQuery).matches ? "dark" : "light";
}

function readStoredTheme(storageKey: string): Theme | null {
  try {
    const storedTheme = window.localStorage.getItem(storageKey);
    return storedTheme && themeNames.has(storedTheme as Theme) ? (storedTheme as Theme) : null;
  } catch {
    return null;
  }
}

function normalizeTheme(theme: Theme | undefined, enableSystem: boolean): Theme {
  if (theme === "light" || theme === "dark") {
    return theme;
  }

  return enableSystem ? "system" : "light";
}

function disableTransitions() {
  const style = document.createElement("style");
  style.appendChild(document.createTextNode("* { transition: none !important; }"));
  document.head.appendChild(style);

  // Flush style recalculation before removing the temporary override.
  void window.getComputedStyle(document.body);

  return () => {
    window.setTimeout(() => {
      document.head.removeChild(style);
    }, 0);
  };
}

function applyTheme(
  attribute: string,
  resolvedTheme: ResolvedTheme,
  disableTransitionOnChange: boolean,
) {
  const root = document.documentElement;
  const restoreTransitions = disableTransitionOnChange ? disableTransitions() : null;

  if (attribute === "class") {
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  } else {
    root.setAttribute(attribute, resolvedTheme);
  }

  root.style.colorScheme = resolvedTheme;
  restoreTransitions?.();
}

export function ThemeProvider({
  attribute = "data-theme",
  children,
  defaultTheme = "system",
  disableTransitionOnChange = false,
  enableSystem = true,
  storageKey = themeStorageKey,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return normalizeTheme(defaultTheme, enableSystem);
    }

    return readStoredTheme(storageKey) ?? normalizeTheme(defaultTheme, enableSystem);
  });
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    return getSystemTheme();
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(themeQuery);
    const updateSystemTheme = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);

    return () => {
      mediaQuery.removeEventListener("change", updateSystemTheme);
    };
  }, []);

  useEffect(() => {
    const nextTheme = normalizeTheme(theme, enableSystem);

    try {
      window.localStorage.setItem(storageKey, nextTheme);
    } catch {
      // Ignore storage failures so theme switching still works in restricted environments.
    }

    applyTheme(
      attribute,
      nextTheme === "system" ? systemTheme : nextTheme,
      disableTransitionOnChange,
    );
  }, [attribute, disableTransitionOnChange, enableSystem, storageKey, systemTheme, theme]);

  return (
    <ThemeContext.Provider
      value={{
        resolvedTheme: theme === "system" ? systemTheme : theme,
        setTheme: (nextTheme) => {
          setThemeState(normalizeTheme(nextTheme, enableSystem));
        },
        systemTheme,
        theme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}

export type { Theme, ThemeProviderProps };
