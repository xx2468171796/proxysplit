// 页面切换 + 页内分区（tab）+ 跨页意图（例如概览「添加应用」→ 跳到应用分流并打开选择器）+ 设置页分节跳转。
// 同类页面合并在一个导航项下（业主 2026-10-28）：节点|订阅、应用分流|端口代理、日志|诊断、AI 各分区。
import { useEffect, useState } from "react";
import { createStore, useStore } from "../shared/store";

export type PageId = "overview" | "flows" | "ai" | "nodes" | "apps" | "rules" | "logs" | "settings";
/** 合并页里的分区 id；navigate(page, intent, tab) 带上就切到那个分区。 */
export type PageTab = "nodes" | "subs" | "apps" | "ports" | "conns" | "logs" | "diag" | "env" | "accel" | "control";
export type Intent = "add-app" | "add-node" | "add-sub";
/** 设置页分节 id（settings-page.tsx 的 SECTIONS）。 */
export type SettingsSection = "account" | "general" | "network" | "core" | "reset";

type NavState = { page: PageId; tab: PageTab | null; intent: Intent | null; section: SettingsSection | null };

export const nav = createStore<NavState>({ page: "overview", tab: null, intent: null, section: null });

export function navigate(page: PageId, intent: Intent | null = null, tab: PageTab | null = null): void {
  nav.set({ page, intent, tab });
}

/** 打开设置页并滚到某个分节（任何地方的「清除与重置」入口都跳到同一处）。 */
export function openSettings(section: SettingsSection): void {
  nav.set({ page: "settings", tab: null, intent: null, section });
}

export const usePage = () => useStore(nav, (s) => s.page);

function isTab<T extends PageTab>(allowed: readonly T[], id: string | null): id is T {
  return id !== null && (allowed as readonly string[]).includes(id);
}

/** 合并页的当前分区（allowed 第一个是默认）；有人 navigate 带了本页认识的 tab 就切过去并清掉。allowed 用模块常量。 */
export function usePageTab<T extends PageTab>(allowed: readonly [T, ...T[]]): [T, (id: string) => void] {
  const pending = useStore(nav, (s) => s.tab);
  const [tab, setTab] = useState<T>(() => (isTab(allowed, pending) ? pending : allowed[0]));
  useEffect(() => {
    if (!isTab(allowed, pending)) return;
    setTab(pending);
    nav.set({ tab: null });
  }, [allowed, pending]);
  const select = (id: string) => {
    if (isTab(allowed, id)) setTab(id);
  };
  return [tab, select];
}

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
