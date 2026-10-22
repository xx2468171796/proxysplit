// 分流规则页的数据：地区规则库（geosite / geoip）、自定义规则、自定义线路。
import { api } from "../api/backend";
import type { Line, RouteRule, RuleSet } from "../api/types";
import { createStore } from "../shared/store";
import { data, refreshLines, setDefaultLine } from "./data";

export type RoutingState = { ruleSets: RuleSet[]; customRules: RouteRule[] };

export const routing = createStore<RoutingState>({ ruleSets: [], customRules: [] });

/** 内置线路给用户看的名字（Go 里叫 规则 / 全局 / 直连 / 拦截） */
export const BUILTIN_LINES = {
  rule: { label: "智能分流", hint: "国内直连，国外走代理" },
  global: { label: "全部代理", hint: "所有连接都走代理" },
  direct: { label: "不走代理", hint: "直接连接，不经过节点" },
  block: { label: "禁止联网", hint: "这个程序断网" },
} as const;

type BuiltinLine = keyof typeof BUILTIN_LINES;
const builtin = (id: string) => BUILTIN_LINES[id as BuiltinLine] as (typeof BUILTIN_LINES)[BuiltinLine] | undefined;

export const builtinLineOptions = (ids: BuiltinLine[]) => ids.map((id) => ({ value: id, ...BUILTIN_LINES[id] }));

export function lineLabel(id: string, lines: Line[]): string {
  return builtin(id)?.label || lines.find((l) => l.id === id)?.name || BUILTIN_LINES.rule.label;
}

/** 线路显示名：内置的换成白话，自定义的用用户起的名字 */
export const lineName = (l: { id: string; name: string }): string => builtin(l.id)?.label ?? l.name;

/** 自定义线路（非内置）；内置 id 返回 undefined。 */
export function customLineOf(id: string, lines: Line[]): Line | undefined {
  return builtin(id) ? undefined : lines.find((l) => l.id === id && !l.builtin);
}

export function modeLabel(mode: string): string {
  if (mode === "bypass_cn") return "国内直连、国外代理";
  if (mode === "custom") return "自定义";
  return "全部代理";
}

export async function refreshRuleSets(): Promise<void> {
  routing.set({ ruleSets: await api.ruleSets().catch(() => routing.get().ruleSets) });
}

export async function refreshCustomRules(): Promise<void> {
  routing.set({ customRules: await api.customRules().catch(() => routing.get().customRules) });
}

export async function setRuleSetEnabled(name: string, on: boolean): Promise<string> {
  const err = await api.setRuleSetEnabled(name, on);
  await refreshRuleSets();
  return err;
}

/** 规则库源在墙外，更新走当前节点下载。 */
export async function updateRuleSets(): Promise<string> {
  const err = await api.updateRuleSets().catch((e) => String(e));
  await refreshRuleSets();
  return err;
}

/** 保存自定义规则（空内容的行丢弃）。 */
export async function saveCustomRules(rules: RouteRule[]): Promise<string> {
  const err = await api.setCustomRules(rules.filter((r) => (r.value || "").trim()));
  if (!err) await refreshCustomRules();
  return err;
}

export type LineDraft = { id: string; name: string; node: string; mode: string; rules: RouteRule[] };

export async function saveLine(draft: LineDraft): Promise<string> {
  const name = draft.name.trim();
  if (!name) return "请填写线路名称";
  const id = draft.id || `line-${Date.now()}`;
  const entry: Line = {
    id,
    name,
    node: draft.node,
    routing: { mode: draft.mode, rules: draft.rules.filter((r) => r.value.trim()) },
    builtin: false,
  };
  const custom = [...data.get().lines.filter((l) => !l.builtin && l.id !== id), entry];
  const err = await api.setLines(custom);
  if (err) return `线路保存失败：${err}`;
  await refreshLines();
  return "";
}

/** 删线路时，用到它的应用和「默认线路」一并改回「规则」。 */
export async function deleteLine(line: Line): Promise<string> {
  const custom = data.get().lines.filter((x) => !x.builtin && x.id !== line.id);
  const err = await api.setLines(custom);
  if (err) return `线路删除失败：${err}`;
  await refreshLines();
  const rules = data.get().rules;
  if (rules.some((r) => r.line === line.id)) {
    const next = rules.map((r) => (r.line === line.id ? { ...r, line: "rule" } : r));
    data.set({ rules: next });
    await api.setAppRules(next);
  }
  if (data.get().defaultLine === line.id) await setDefaultLine("rule");
  return "";
}
