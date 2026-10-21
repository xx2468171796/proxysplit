import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useState } from "react";

import { DEFAULT_THEME, NEUTRAL_TOKENS, readTokens, type ThemeName, type ThemeTokens } from "./tokens.ts";

interface ThemeState {
  theme: ThemeName;
  tokens: ThemeTokens;
}

const ThemeContext = createContext<ThemeState>({ theme: DEFAULT_THEME, tokens: NEUTRAL_TOKENS });

interface ThemeProviderProps {
  theme: ThemeName;
  children: ReactNode;
}

/**
 * 把主题挂到 <html data-theme> 上，并在同一个 layout effect 里读出令牌的具体色值。
 * 必须在这里读而不是在各组件里读：子组件的 effect 先于父组件执行，各读各的会读到切换前的主题。
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  const [tokens, setTokens] = useState<ThemeTokens>(NEUTRAL_TOKENS);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    setTokens(readTokens(root));
  }, [theme]);

  const value = useMemo(() => ({ theme, tokens }), [theme, tokens]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** 当前主题令牌（具体色值），直接当 props 喂给 dongxiao 组件 */
export function useTokens(): ThemeTokens {
  return useContext(ThemeContext).tokens;
}
