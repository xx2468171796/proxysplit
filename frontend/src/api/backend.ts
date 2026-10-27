// 后端适配层：界面只经这里调用 Go（Wails 绑定）。
// Go 的 nil 切片会序列化成 null，这里统一兜成空数组 / 默认值，界面层不用再判空。
// 写操作沿用 Go 端约定：返回空串 = 成功，非空 = 给用户看的错误信息。
import * as W from "../../wailsjs/go/main/App.js";
import { EventsOn } from "../../wailsjs/runtime/runtime.js";
import type {
  AccelState,
  AccountDevice,
  AIControlInfo,
  AIEnvReport,
  AIHijack,
  Announcement,
  AppDetail,
  AppRule,
  AppStat,
  AppUpdateStatus,
  BootstrapState,
  CatalogApp,
  Conn,
  EnvItem,
  Health,
  LicenseStatus,
  Line,
  MemberOrder,
  MemberPlan,
  Node,
  PortDetail,
  PortMode,
  Proc,
  ProxyPort,
  ProxyPortStatus,
  RouteRule,
  RouteTestResult,
  RuleImportPreview,
  RuleSet,
  Settings,
  Status,
  Sub,
} from "./types";

type Listed<T> = { items: T[]; err?: string };
const listOf = <T>(r: { items?: unknown; err?: string } | null | undefined): Listed<T> => ({
  items: Array.isArray(r?.items) ? (r.items as T[]) : [],
  err: r?.err || undefined,
});
const arr = <T>(v: T[] | null | undefined): T[] => v ?? [];
// 生成的绑定参数是带 convertValues 的类；界面传纯对象，在边界处转一次。
const asArg = <T>(v: unknown): T => v as T;

export type OrderCreated = { order?: MemberOrder; orders: MemberOrder[]; split: boolean; err?: string };
export type QrResult = { data: string; err: string };
export type NodeShareResult = { link: string; qr: string; err: string };
export type SpeedResult = { mbps: number; err: string };
export type ReleaseNote = { version: string; items: string[] };

export const api = {
  // 启动与状态
  bootstrap: () => W.GetBootstrapState() as Promise<BootstrapState>,
  status: () => W.GetStatus() as Promise<Status>,
  health: async (): Promise<Health> => {
    const h = (await W.GetHealth()) as Health;
    return { ...h, lines: arr(h?.lines) };
  },
  connections: async () => arr((await W.GetConnections()) as Conn[]),
  start: () => W.Start(),
  stop: () => W.Stop(),
  restart: () => W.Restart(),
  appVersion: () => W.GetAppVersion(),
  coreVersion: () => W.GetCoreVersion(),
  updateCore: () => W.UpdateCore(),
  lanIP: () => W.GetLanIP(),
  updateNotes: async () => arr((await W.GetUpdateNotes()) as ReleaseNote[]).map((n) => ({ ...n, items: arr(n.items) })),
  markUpdateNotesSeen: () => W.MarkUpdateNotesSeen(),
  // 客户端日志上报：记一次主界面页面访问（失败无所谓）
  trackPage: (page: string) => W.TrackPage(page).catch(() => undefined),

  // 节点
  nodes: async () => arr((await W.GetNodes()) as Node[]),
  addNodes: (links: string) => W.AddNodes(links),
  addManualNode: (type: string, name: string, server: string, port: number, user: string, pass: string) =>
    W.AddManualNode(type, name, server, port, user, pass),
  removeNode: (id: string) => W.RemoveNode(id),
  selectNode: (id: string) => W.SelectNode(id),
  testAllLatency: () => W.TestAllLatency(),
  testLatency: (id: string) => W.TestLatency(id),
  testTCP: (id: string) => W.TestTCP(id),
  speedTest: () => W.SpeedTest() as Promise<SpeedResult>,
  speedTestNode: (id: string) => W.SpeedTestNode(id) as Promise<SpeedResult>,
  nodeShare: (id: string) => W.GetNodeShare(id) as Promise<NodeShareResult>,

  // 应用分流
  appRules: async () => arr((await W.GetAppRules()) as AppRule[]),
  setAppRules: (rules: AppRule[]) => W.SetAppRules(asArg(rules)),
  ruleMode: () => W.GetRuleMode(),
  setRuleMode: (mode: string) => W.SetRuleMode(mode),
  processes: async () => arr((await W.ListProcesses()) as Proc[]),
  pickExeFiles: async () => arr(await W.PickExeFiles()),
  appIcon: (path: string) => W.GetAppIcon(path),
  testApp: (match: string) => W.TestApp(match),
  exportAppRules: () => W.ExportAppRules(),
  previewAppRulesImport: (json: string) => W.PreviewAppRulesImport(json) as Promise<RuleImportPreview>,
  importAppRules: (json: string) => W.ImportAppRules(json),

  // 应用库（模拟器预设 + 自定义）与逐应用监测
  appCatalog: async () => arr((await W.GetAppCatalog()) as CatalogApp[]),
  setCustomApps: (apps: CatalogApp[]) => W.SetCustomApps(asArg(apps)),
  appStats: async (names: string[]) => arr((await W.GetAppStats(names)) as AppStat[]),
  appMonitorDetail: async (process: string): Promise<AppDetail> => {
    const d = (await W.GetAppMonitorDetail(process)) as AppDetail;
    return { stat: d.stat, processes: arr(d.processes), hosts: arr(d.hosts), access: arr(d.access), logs: arr(d.logs) };
  },
  resetAppMonitor: (process: string) => W.ResetAppMonitor(process),
  appRouteTest: async (process: string, url: string): Promise<RouteTestResult> => {
    const r = (await W.AppRouteTest(process, url)) as RouteTestResult;
    return { ...r, hops: arr(r.hops) };
  },

  // 线路与规则
  lines: async () => arr((await W.GetLines()) as Line[]),
  setLines: (custom: Line[]) => W.SetLines(asArg(custom)),
  defaultLine: () => W.GetDefaultLine(),
  setDefaultLine: (id: string) => W.SetDefaultLine(id),
  clashMode: () => W.GetClashMode(),
  setClashMode: (mode: string) => W.SetClashMode(mode),
  ruleSets: async () => arr((await W.GetRuleSets()) as RuleSet[]),
  setRuleSetEnabled: (name: string, on: boolean) => W.SetRuleSetEnabled(name, on),
  updateRuleSets: () => W.UpdateRuleSets(),
  customRules: async () => arr((await W.GetCustomRules()) as RouteRule[]),
  setCustomRules: (rules: RouteRule[]) => W.SetCustomRules(asArg(rules)),

  // 端口代理
  proxyPorts: async () =>
    arr((await W.GetProxyPorts()) as ProxyPortStatus[]).map((p) => ({ ...p, clients: arr(p.clients) })),
  saveProxyPort: (p: ProxyPort) => W.SaveProxyPort(asArg(p)),
  deleteProxyPort: (id: string) => W.DeleteProxyPort(id),
  setProxyPortEnabled: (id: string, on: boolean) => W.SetProxyPortEnabled(id, on),
  setProxyPortMode: (id: string, mode: PortMode) => W.SetProxyPortMode(id, mode),
  proxyPortDetail: async (id: string, client: string): Promise<PortDetail> => {
    const d = (await W.GetProxyPortDetail(id, client)) as PortDetail | null;
    return { conns: arr(d?.conns), access: arr(d?.access), logs: arr(d?.logs) };
  },

  // 订阅
  subs: async () => arr((await W.GetSubs()) as Sub[]),
  addSub: (name: string, url: string, auto: boolean) => W.AddSub(name, url, auto),
  editSub: (id: string, name: string, url: string) => W.EditSub(id, name, url),
  updateSub: (id: string) => W.UpdateSub(id),
  removeSub: (id: string) => W.RemoveSub(id),
  setSubAutoUpdate: (id: string, on: boolean) => W.SetSubAutoUpdate(id, on),

  // 设置与系统
  settings: () => W.GetSettings() as Promise<Settings>,
  setSettings: (s: Settings) => W.SetSettings(asArg(s)),
  autostart: () => W.GetAutostart(),
  setAutostart: (on: boolean) => W.SetAutostart(on),
  logLevel: () => W.GetLogLevel(),
  setLogLevel: (level: string) => W.SetLogLevel(level),
  exportConfig: () => W.ExportConfig(),
  importConfig: () => W.ImportConfig(),
  resetConfig: () => W.ResetConfig(),
  aiControlInfo: () => W.GetAIControlInfo() as Promise<AIControlInfo>,
  claudeAccel: () => W.GetClaudeAccel() as Promise<AccelState>,
  setClaudeAccelMode: (mode: string) => W.SetClaudeAccelMode(mode),
  // 服务没起来时 Go 回空报告，items 是 null。
  checkAIEnv: async (): Promise<AIEnvReport> => {
    const r = (await W.CheckAIEnv()) as AIEnvReport;
    return { ...r, items: r?.items ?? [] };
  },
  fixAIEnv: (id: string) => W.FixAIEnv(id),
  aiHijack: () => W.GetAIHijack() as Promise<AIHijack>,
  setAIHijack: (on: boolean) => W.SetAIHijack(on),
  // Go 返回 nil 切片时是 null。
  envConfig: async (): Promise<EnvItem[]> => ((await W.GetEnvConfig()) as EnvItem[] | null) ?? [],
  applyEnvConfig: (ids: string[]) => W.ApplyEnvConfig(ids),
  restoreEnvConfig: (ids: string[]) => W.RestoreEnvConfig(ids),
  restoreAllAI: () => W.RestoreAllAI(),
  copyToClipboard: (text: string) => W.CopyToClipboard(text),
  openWebsite: () => W.OpenWebsite(),
  openGitHub: () => W.OpenGitHub(),

  // 软件更新
  checkAppUpdate: () => W.CheckAppUpdate() as Promise<AppUpdateStatus>,
  installAppUpdate: (s: AppUpdateStatus) => W.InstallAppUpdate(asArg(s.release)),

  // 账号与会员
  license: () => W.GetLicenseStatus() as Promise<LicenseStatus>,
  login: (user: string, pass: string) => W.Login(user, pass),
  register: (user: string, email: string, pass: string, ref: string) => W.Register(user, email, pass, ref),
  // 推广赚钱（多级分销）：Go 端按白名单拼路径，这里只传种类
  fenxiao: (kind: "me" | "team" | "commissions" | "withdrawals", level = 0, offset = 0) =>
    W.GetFenxiao(kind, level, offset),
  fenxiaoWithdraw: (amountCents: number, method: string, account: string, name: string) =>
    W.RequestFenxiaoWithdrawal(amountCents, method, account, name),
  logout: () => W.Logout(),
  loginPowerVPN: () => W.LoginPowerVPN(),
  logoutPowerVPN: () => W.LogoutPowerVPN(),
  autoLoginPending: () => W.AutoLoginPending(),
  waitAutoLogin: () => W.WaitAutoLogin(),
  changePassword: (current: string, next: string) => W.ChangeAccountPassword(current, next),
  refreshEntitlement: () => W.RefreshEntitlement(),
  redeemCode: (code: string) => W.RedeemCode(code),
  plans: async () => listOf<MemberPlan>(await W.GetMembershipPlans()),
  devices: async () => listOf<AccountDevice>(await W.GetMyDevices()),
  orders: async () => listOf<MemberOrder>(await W.GetMyOrders()),
  announcements: async () => listOf<Announcement>(await W.GetAnnouncements()),
  unbindDevice: (id: string) => W.UnbindMyDevice(id),
  activateCurrentDevice: () => W.ActivateCurrentDevice(),
  createOrder: async (planId: string): Promise<OrderCreated> => {
    const r = await W.CreateMembershipOrder(planId);
    return { order: r?.order, orders: arr(r?.orders), split: !!r?.split, err: r?.err || undefined };
  },
  paymentQR: (payUrl: string) => W.GetPaymentQR(payUrl) as Promise<QrResult>,
  openPaymentURL: (url: string) => W.OpenPaymentURL(url),
};

/** 订阅 Go 推送的事件；返回取消函数。 */
export function onBackendEvent<T>(name: string, handler: (payload: T) => void): () => void {
  return EventsOn(name, handler);
}
