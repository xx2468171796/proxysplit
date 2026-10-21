// 页面切换 + 跨页意图（例如概览「添加应用」→ 跳到应用分流并打开选择器）。
import { useEffect } from "react";
import { createStore, useStore } from "../shared/store";

export type PageId = "overview" | "nodes" | "apps" | "ports" | "rules" | "subs" | "logs" | "settings";
export type Intent = "add-app" | "add-node" | "add-sub";

export const nav = createStore<{ page: PageId; intent: Intent | null }>({ page: "overview", intent: null });

export function navigate(page: PageId, intent: Intent | null = null): void {
  nav.set({ page, intent });
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
