// 应用分流规则：增删改后整表推给 Go 保存（运行中实时生效）。另含运行中进程、程序图标、逐应用测连通。
import { api } from "../api/backend";
import type { AppRule, Proc } from "../api/types";
import { appDisplayName, dirDisplayName } from "../shared/app-names";
import { baseName } from "../shared/format";
import { createStore } from "../shared/store";
import { data, NOT_LOADED, refreshLines, refreshRules } from "./data";
import { refreshCustomRules, refreshRuleSets } from "./routing";

export type AppsState = {
  /** 运行中的进程（选择器和规则图标共用） */
  procs: Proc[];
  /** 小写 exe 名 → 正在运行 */
  running: Set<string>;
  /** 程序路径 → 图标 data URI（'' = 读不到） */
  icons: Record<string, string>;
  /** rule.match → 测试结果 ms（-99 测试中） */
  latency: Record<string, number>;
};

export const apps = createStore<AppsState>({ procs: [], running: new Set(), icons: {}, latency: {} });

const sameMatch = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** 整个目录的规则（match 以 \ 结尾）：目录下所有程序都算这个应用 */
export const isDirRule = (r: AppRule): boolean => (r.match || "").trim().length > 3 && /[\\/]$/.test(r.match || "");

export function ruleName(r: AppRule): string {
  const m = r.match || r.path || "?";
  if (isDirRule(r)) return `${baseName(m.replace(/[\\/]+$/, ""))}（整个目录）`;
  return /[\\/]/.test(m) ? baseName(m) : m;
}

/** 给用户看的名字（雷电模拟器、Chrome 浏览器…）；提示、监测等仍用 ruleName */
export const ruleDisplayName = (r: AppRule, procs: Proc[]): string =>
  isDirRule(r) ? dirDisplayName(r.match) : appDisplayName(r.path || r.match, procs);

/** 查监测用的键：目录规则用完整目录，其余用程序名 */
export const monitorKey = (r: AppRule): string => (isDirRule(r) ? r.match : ruleName(r));

/** 规则可能只存了 exe 名：优先用运行中进程的真实路径去取原始图标。 */
export function ruleIconPath(r: AppRule, procs: Proc[]): string {
  if (r.path && /\.exe$/i.test(r.path)) return r.path;
  const exe = baseName(r.match || r.path).toLowerCase();
  return procs.find((p) => baseName(p.path || p.name).toLowerCase() === exe)?.path || r.path || "";
}

export const hasScope = (r: AppRule): boolean => !!(r.domains?.length || r.ips?.length || r.ports?.length);

const pendingIcons = new Set<string>();
export async function loadIcon(path: string): Promise<void> {
  if (!path || path in apps.get().icons || pendingIcons.has(path)) return;
  pendingIcons.add(path);
  const uri = await api.appIcon(path).catch(() => "");
  apps.set((s) => ({ icons: { ...s.icons, [path]: uri || "" } }));
  pendingIcons.delete(path);
}

export async function refreshProcesses(): Promise<void> {
  const procs = await api.processes().catch(() => apps.get().procs);
  const running = new Set(procs.map((p) => (p.name || "").toLowerCase()));
  apps.set({ procs, running });
  for (const r of data.get().rules) void loadIcon(ruleIconPath(r, procs));
}

/** 保存整表。返回错误文本（空串 = 成功）。 */
async function push(rules: AppRule[]): Promise<string> {
  // 首屏数据没到之前屏幕上是空表，整表推送会把用户已保存的规则清掉。
  if (!data.get().loaded) return NOT_LOADED;
  data.set({ rules });
  return api.setAppRules(rules);
}

export async function addRule(match: string, path = ""): Promise<string> {
  const value = match.trim();
  const rules = data.get().rules;
  if (!value || rules.some((r) => sameMatch(r.match || "", value))) return "";
  return push([...rules, { match: value, path: path || value, line: "rule", node: "", enabled: true }]);
}

/** 批量加规则（应用库一次加一个应用的多个进程），已有的跳过。保存失败时按 Go 端实际状态重读。返回新增条数与错误。 */
export async function addRules(list: AppRule[]): Promise<{ added: number; err: string }> {
  const rules = data.get().rules;
  const fresh = list.filter((r) => !rules.some((x) => sameMatch(x.match || "", r.match)));
  if (!fresh.length) return { added: 0, err: "" };
  const err = await push([...rules, ...fresh]);
  if (err && err !== NOT_LOADED) await refreshRules();
  return { added: fresh.length, err };
}

export function isRuleAdded(match: string): boolean {
  return data.get().rules.some((r) => sameMatch(r.match || "", match));
}

// 按程序名定位而不是按行号：编辑期间列表可能被重新读取（切回前台、AI 控制接口改了规则）。
export async function updateRule(match: string, patch: Partial<AppRule>): Promise<string> {
  return push(data.get().rules.map((r) => (sameMatch(r.match || "", match) ? { ...r, ...patch } : r)));
}

export async function removeRule(match: string): Promise<string> {
  return push(data.get().rules.filter((r) => !sameMatch(r.match || "", match)));
}

/** 撤销删除：放回原位置（同名已存在则不重复加）。 */
export async function insertRule(index: number, rule: AppRule): Promise<string> {
  const rules = data.get().rules;
  if (rules.some((r) => sameMatch(r.match || "", rule.match || ""))) return "";
  const at = Math.min(Math.max(index, 0), rules.length);
  return push([...rules.slice(0, at), rule, ...rules.slice(at)]);
}

/** 选择器里的进程是否已有规则（规则可能存 exe 名也可能存完整路径，按 exe 名比对）。 */
export function procHasRule(p: Proc, rules: AppRule[]): boolean {
  const exe = baseName(p.path || p.name).toLowerCase();
  return rules.some((r) => baseName(r.match || r.path).toLowerCase() === exe);
}

/** 规则对应的程序是否正在运行（按 exe 名比对）。 */
export const isRuleRunning = (r: AppRule, running: Set<string>): boolean =>
  running.has(baseName(r.match || r.path).toLowerCase());

export async function clearRules(): Promise<string> {
  return push([]);
}

/** 从文件夹选 exe（不必正在运行）。返回添加的个数。 */
export async function pickFiles(): Promise<number> {
  const paths = await api.pickExeFiles();
  for (const p of paths) await addRule(p.endsWith(".app") ? `${p}/` : baseName(p), p);
  return paths.length;
}

export async function testApp(match: string): Promise<void> {
  apps.set((s) => ({ latency: { ...s.latency, [match]: -99 } }));
  const ms = await api.testApp(match).catch(() => -1);
  apps.set((s) => ({ latency: { ...s.latency, [match]: ms } }));
}

/** 导出规则 JSON 到剪贴板。 */
export async function exportRules(): Promise<string> {
  const json = await api.exportAppRules();
  try {
    await navigator.clipboard.writeText(json);
    return "规则已复制到剪贴板";
  } catch {
    return "复制失败，请重试";
  }
}

/** 导入：先预检，返回摘要给调用方确认；确认后 applyImport。 */
export async function previewImport(json: string): Promise<{ summary?: string; err?: string }> {
  const p = await api.previewAppRulesImport(json);
  return p.error ? { err: `预检失败：${p.error}` } : { summary: p.summary };
}

export async function applyImport(json: string): Promise<string> {
  const err = await api.importAppRules(json);
  if (err) return `导入失败：${err}`;
  await Promise.all([refreshRules(), refreshLines()]);
  const [defaultLine, ruleMode] = await Promise.all([api.defaultLine(), api.ruleMode()]);
  data.set({ defaultLine: defaultLine || "rule", ruleMode: ruleMode === "blacklist" ? "blacklist" : "whitelist" });
  await Promise.all([refreshCustomRules(), refreshRuleSets()]);
  return "";
}
