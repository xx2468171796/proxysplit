// 主题：品牌墨色、明暗模式（只认设置页 settings.theme，「跟随」时跟系统），以及桌面外壳 qiantai 的外观（同一主色、同一明暗）。

import { DEFAULT_BACKDROP, type DesktopLook, LANG, type Lang } from "qiantai/desktop";
import { useSyncExternalStore } from "react";

/**
 * 品牌主色：近黑的墨色（业主 2026-10-22）。组件库在深色模式下会把主色再压暗做按钮底色，
 * 近黑会和深色面板糊在一起，所以深色模式换一档偏亮的石墨色。
 */
export const BRAND_INK = { light: "#1c1f24", dark: "#6b7584" } as const;
export type Mode = "light" | "dark" | "system";
export const asMode = (t: string): Mode => (t === "dark" || t === "system" ? t : "light");

const DARK_QUERY = "(prefers-color-scheme: dark)";
const subscribeScheme = (fn: () => void) => {
  const mq = matchMedia(DARK_QUERY);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
};

export function useResolvedDark(mode: Mode): boolean {
  const systemDark = useSyncExternalStore(subscribeScheme, () => matchMedia(DARK_QUERY).matches);
  return mode === "dark" || (mode === "system" && systemDark);
}

/** 设计语言 clean-modern；包里总会有它，万一改名就退回第一种，不白屏。 */
const CLEAN_MODERN: Lang | undefined = LANG["clean-modern"];

export function desktopLook(dark: boolean): DesktopLook | null {
  if (!CLEAN_MODERN) return null;
  return { brand: dark ? BRAND_INK.dark : BRAND_INK.light, lang: CLEAN_MODERN, dark, intensity: "calm" };
}

/** 外壳存设置用的键（qiantai 存成 `${STORAGE_KEY}:backdrop` 等）。 */
export const STORAGE_KEY = "proxysplit";

/**
 * 本应用的默认外观：柔光背景淡一些（35）、毛玻璃、均衡画质、智能暂停。
 * qiantai 只认本机存的值，没存过时先写入我们的默认；用户改过就不动。
 */
export function seedDefaultAppearance(): void {
  const key = `${STORAGE_KEY}:backdrop`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        ...DEFAULT_BACKDROP,
        effect: "soft-aurora",
        strength: 35,
        glass: true,
        quality: "balanced",
        smart: true,
      }),
    );
  } catch {
    // 存不进去就用包默认
  }
}
