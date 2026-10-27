// 页面切换 + 跨页意图（例如概览「添加应用」→ 跳到应用分流并打开选择器）+ 设置页分节跳转。
import { useEffect } from "react";
import { createStore, useStore } from "../shared/store";

export type PageId = "overview" | "ai" | "nodes" | "apps" | "ports" | "rules" | "subs" | "logs" | "settings";
export type Intent = "add-app" | "add-node" | "add-sub";
/** 设置页分节 id（settings-page.tsx 的 SECTIONS）。 */
export type SettingsSection = "account" | "general" | "network" | "core" | "rules" | "ai" | "accel" | "diag" | "reset";

export const nav = createStore<{ page: PageId; intent: Intent | null; section: SettingsSection | null }>({
  page: "overview",
  intent: null,
  section: null,
});

export function navigate(page: PageId, intent: Intent | null = null): void {
  nav.set({ page, intent });
}

/** 打开设置页并滚到某个分节（任何地方的「清除与重置」入口都跳到同一处）。 */
export function openSettings(section: SettingsSection): void {
  nav.set({ page: "settings", intent: null, section });
}

export const usePage = () => useStore(nav, (s) => s.page);

/** 页面里接意图：命中就执行并清掉。 */
export function useIntent(intent: Intent, run: () => void): void {
  const current = useStore(nav, (s) => s.intent);
  useEffect(() => {
    if (current !== intent) return;
    nav.set({ intent: null });
    run();
  }, [current, intent, run]);
}

/** 设置页：有待跳转的分节就滚过去（SideNavLayout 的分节 DOM id 以 -sec-<id> 结尾）。 */
export function useSectionJump(): void {
  const section = useStore(nav, (s) => s.section);
  useEffect(() => {
    if (!section) return;
    const t = setTimeout(() => {
      document.querySelector(`[id$="-sec-${section}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      nav.set({ section: null });
    }, 80);
    return () => clearTimeout(t);
  }, [section]);
}
