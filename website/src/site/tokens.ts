/** 令牌的 TypeScript 侧：名字清单 + 读取函数。值的唯一来源是 tokens.css。 */

const THEME_NAMES = ["light", "dark"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** 站点默认主题（front-site 配方的 --style） */
export const DEFAULT_THEME: ThemeName = "light";

const TOKEN_NAMES = [
  "brand",
  "brand-strong",
  "accent",
  "highlight",
  "bg",
  "bg-soft",
  "surface",
  "border",
  "text",
  "text-muted",
  "on-brand",
  "fx-glow",
] as const;
type TokenName = (typeof TOKEN_NAMES)[number];
export type ThemeTokens = Readonly<Record<TokenName, string>>;

/** 无 DOM 或令牌缺失时的中性兜底；只是防空，不是第二份主题 */
const NEUTRAL = "#808080";

/** 从元素上读出全部令牌的具体色值 */
export function readTokens(element: Element): ThemeTokens {
  const style = getComputedStyle(element);
  const entries = TOKEN_NAMES.map((name) => [name, style.getPropertyValue(`--${name}`).trim() || NEUTRAL] as const);
  return Object.fromEntries(entries) as Record<TokenName, string>;
}

export const NEUTRAL_TOKENS: ThemeTokens = Object.fromEntries(
  TOKEN_NAMES.map((name) => [name, NEUTRAL] as const),
) as Record<TokenName, string>;

/** "#rrggbb" → "rgba(r, g, b, a)"；非 6 位 hex 原样返回（给只吃具体色值的组件做半透明） */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return hex;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? "0", 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
