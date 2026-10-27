// 持久化的用户数据：节点、应用规则、线路、订阅、设置、分流模式。
// 只有这里写这些数据；页面调用这里的动作，动作返回 Go 端的错误文本（空串 = 成功）。
import { api } from "../api/backend";
import type {
  AppRule,
  BootstrapState,
  ClashMode,
  Line,
  NetSettings,
  Node,
  RuleMode,
  Settings,
  Sub,
} from "../api/types";
import { createStore } from "../shared/store";
import { license } from "./account";
import { refreshStatus, runtime } from "./runtime";

export type DataState = {
  loaded: boolean;
  nodes: Node[];
  rules: AppRule[];
  lines: Line[];
  subs: Sub[];
  settings: Settings;
  defaultLine: string;
  ruleMode: RuleMode;
  clashMode: ClashMode;
};

const DEFAULT_SETTINGS: Settings = {
  mixedPort: 10808,
  tunMode: false,
  lanShare: false,
  excludeSelf: true,
  privateDirect: true,
  blockQUIC: true,
  remoteDNS: true,
  fakeIP: false,
  autostart: false,
  trayClose: true,
  theme: "light",
  lanPort: 7890,
  lanType: "mixed",
  lanUser: "",
  lanPass: "",
  autoUpdateApp: true,
};

export const data = createStore<DataState>({
  loaded: false,
  nodes: [],
  rules: [],
  lines: [],
  subs: [],
  settings: DEFAULT_SETTINGS,
  defaultLine: "rule",
  ruleMode: "whitelist",
  clashMode: "rule",
});

const asRuleMode = (m: string | undefined): RuleMode => (m === "blacklist" ? "blacklist" : "whitelist");
const asClashMode = (m: string | undefined): ClashMode => (m === "global" || m === "direct" ? m : "rule");

export function normalizeRules(list: AppRule[] | null | undefined): AppRule[] {
  return (list ?? []).map((r) => ({
    match: r.match,
    path: r.path,
    line: r.line || "rule",
    node: r.node || "",
    enabled: !!r.enabled,
    domains: r.domains ?? [],
    ips: r.ips ?? [],
    ports: r.ports ?? [],
  }));
}

/** Go 的 OnDomReady 推来的快照（或首个 GetBootstrapState）。ready 不为 true 时不落地。 */
export function applyBootstrap(s: BootstrapState | null | undefined): boolean {
  if (s?.ready !== true) {
    if (s?.error) console.error("[ProxySplit] backend startup failed:", s.error);
    return false;
  }
  data.set({
    loaded: true,
    nodes: s.nodes ?? [],
    rules: normalizeRules(s.rules),
    lines: s.lines ?? [],
    subs: s.subs ?? [],
    settings: s.settings ?? data.get().settings,
    defaultLine: s.defaultLine || "rule",
    ruleMode: asRuleMode(s.ruleMode),
  });
  if (s.status) runtime.set({ status: s.status });
  if (s.license) license.set({ status: s.license });
  return true;
}

/** 首次加载：GetBootstrapState 在 Go 端等服务就绪，失败就由调用方重试。 */
export async function loadBootstrap(): Promise<boolean> {
  if (data.get().loaded) return true;
  try {
    return applyBootstrap(await api.bootstrap());
  } catch (e) {
    console.warn("[ProxySplit] bootstrap load failed; will retry", e);
    return false;
  }
}

/**
 * 重新读一份完整快照。节点和规则是不可替代的用户数据，两者都成功才替换；
 * 其余数据尽力而为，单项失败保留屏幕上已有的值。
 */
export async function reloadData(): Promise<boolean> {
  // 首屏快照（含授权状态）没落地前不抢先标记 loaded，否则启动流程会以为已加载完而跳过授权。
  if (!data.get().loaded) return false;
  try {
    const [nodes, rules] = await Promise.all([api.nodes(), api.appRules()]);
    data.set({ nodes, rules: normalizeRules(rules), loaded: true });
  } catch (e) {
    console.warn("[ProxySplit] persisted data reload failed; will retry", e);
    return false;
  }
  const cur = data.get();
  const [lines, subs, settings, defaultLine, ruleMode, clashMode] = await Promise.all([
    api.lines().catch(() => cur.lines),
    api.subs().catch(() => cur.subs),
    api.settings().catch(() => cur.settings),
    api.defaultLine().catch(() => cur.defaultLine),
    api.ruleMode().catch(() => cur.ruleMode),
    api.clashMode().catch(() => cur.clashMode),
  ]);
  data.set({
    lines,
    subs,
    settings: settings ?? cur.settings,
    defaultLine: defaultLine || "rule",
    ruleMode: asRuleMode(ruleMode),
    clashMode: asClashMode(clashMode),
  });
  return true;
}

export async function refreshNodes(): Promise<void> {
  data.set({ nodes: await api.nodes().catch(() => data.get().nodes) });
}
export async function refreshLines(): Promise<void> {
  data.set({ lines: await api.lines().catch(() => data.get().lines) });
}
export async function refreshSubs(): Promise<void> {
  data.set({ subs: await api.subs().catch(() => data.get().subs) });
}
export async function refreshRules(): Promise<void> {
  data.set({ rules: normalizeRules(await api.appRules().catch(() => data.get().rules)) });
}
export async function refreshClashMode(): Promise<void> {
  data.set({ clashMode: asClashMode(await api.clashMode().catch(() => data.get().clashMode)) });
}

/** 写操作在首屏数据到达前一律拒绝（屏幕上还是默认值，写下去会覆盖用户的真实配置）。 */
export const NOT_LOADED = "暂时无法保存：配置还在读取，请稍候再试";

/** 保存设置并刷新运行状态（部分开关会重启内核）。 */
export async function saveSettings(patch: Partial<Settings>): Promise<string> {
  if (!data.get().loaded) return NOT_LOADED;
  const next = { ...data.get().settings, ...patch };
  data.set({ settings: next });
  const err = await api.setSettings(next);
  await refreshStatus();
  return err;
}

/** 保存 DNS 与高级网络选项（Go 先校验，不合法原样返回原因、不改屏幕）。 */
export async function saveNetSettings(net: NetSettings): Promise<string> {
  if (!data.get().loaded) return NOT_LOADED;
  const err = await api.setNetSettings(net);
  if (!err) data.set({ settings: { ...data.get().settings, net } });
  await refreshStatus();
  return err;
}

/**
 * 先改屏幕再等 Go 确认；失败就退回原值。返回的错误带「失败」字样，
 * 让提示按出错显示（Go 的原始错误文本不一定含这类词）。
 */
async function optimistic<K extends "clashMode" | "ruleMode" | "defaultLine">(
  key: K,
  value: DataState[K],
  write: () => Promise<string>,
  failPrefix: string,
): Promise<string> {
  if (!data.get().loaded) return NOT_LOADED;
  const before = data.get()[key];
  if (before === value) return "";
  data.set({ [key]: value } as Pick<DataState, K>);
  const err = await write().catch((e: unknown) => String(e));
  if (!err) return "";
  data.set({ [key]: before } as Pick<DataState, K>);
  return `${failPrefix}：${err}`;
}

/** 代理策略：规则 / 全局 / 直连，切换不重启。 */
export const setClashMode = (mode: ClashMode) =>
  optimistic("clashMode", mode, () => api.setClashMode(mode), "切换代理策略失败");

export const setRuleMode = (mode: RuleMode) =>
  optimistic("ruleMode", mode, () => api.setRuleMode(mode), "切换分流模式失败");

export const setDefaultLine = (id: string) => optimistic("defaultLine", id, () => api.setDefaultLine(id), "保存失败");

export async function selectNode(id: string): Promise<string> {
  const err = await api.selectNode(id).catch((e: unknown) => String(e));
  await refreshStatus();
  return err ? `切换节点失败：${err}` : "";
}
