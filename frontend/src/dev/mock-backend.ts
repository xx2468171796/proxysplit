// 只在 `vite dev` 且不在 Wails 里时装上：给浏览器预览和截图验收一份逼真的假后端。生产包不含本文件。
// 地址参数：?showcase=1 官网截图（普通用户、不显示 AI 劫持），?theme=dark|system 主题，?gate=login 未登录页，?gate=member 无权益会员页（&full=1 设备名额已满），?split=1 拆单付款，?update=1 有新版本，?update=force 强制升级，?page=<页面 id> 打开指定页，?look=1 打开外观面板（见 preview-params.ts）；?tier=free ?phone=0 ?sync=conflict ?profiles=full 见 mock-sync.ts。

import { createAIMock } from "./mock-ai";
import { createAppMonMock } from "./mock-appmon";
import { mockFenxiao } from "./mock-fenxiao";
import { mockLink } from "./mock-link";
import { mockSetNodeCore } from "./mock-node-core";
import { createPortsMock } from "./mock-ports";
import { mockReset } from "./mock-reset";
import { licenseExtras, mockSync } from "./mock-sync";
import { previewSearch } from "./search";

type Fn = (...args: unknown[]) => unknown;

const params = new URLSearchParams(previewSearch());
const gate = params.get("gate");
const update = params.get("update");
const showcase = params.get("showcase") === "1";

// 官网截图用的程序图标：字母方块（不用真实商标）。
const ICON_TONES: Record<string, string> = {
  code: "#2b6cb0",
  chrome: "#c05621",
  wechat: "#2f855a",
  node: "#4a5568",
  discord: "#5a67d8",
  telegram: "#3182ce",
};
function monogram(path: string): string {
  const exe = (path.split(/[\\/]/).pop() ?? "?").replace(/\.exe$/i, "");
  const tone = ICON_TONES[exe.toLowerCase()] ?? "#4a5568";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${tone}'/><text x='16' y='21.5' font-family='Segoe UI,Arial' font-size='15' font-weight='600' fill='white' text-anchor='middle'>${exe.charAt(0).toUpperCase()}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const nodes = [
  {
    id: "n1",
    name: "JP | Tokyo - 01",
    type: "vless",
    server: "jp1.example.net",
    network: "xhttp",
    coreInfo: { effective: "xray", xrayOnly: true, xraySupported: true },
    port: 443,
    latency: 48,
    tcpLatency: 31,
    speed: 11.2,
  },
  {
    id: "n2",
    name: "US | Los Angeles - 02",
    type: "hysteria2",
    coreInfo: { effective: "sing-box", xrayOnly: false, xraySupported: false },
    server: "us2.example.net",
    port: 8443,
    latency: 162,
    tcpLatency: 140,
    speed: 6.8,
  },
  {
    id: "n3",
    name: "HK | 香港 BGP",
    type: "trojan",
    coreInfo: { effective: "sing-box", xrayOnly: false, xraySupported: true },
    server: "hk.example.net",
    port: 443,
    latency: 0,
    tcpLatency: 0,
    speed: 0,
  },
  {
    id: "n4",
    name: "SG | Singapore",
    type: "socks",
    core: "xray",
    coreInfo: { effective: "xray", xrayOnly: false, xraySupported: true },
    server: "10.0.0.8",
    port: 1080,
    latency: -1,
    tcpLatency: 92,
    speed: 0,
  },
];
const rules = [
  { match: "Code.exe", path: "C:\\Program Files\\Microsoft VS Code\\Code.exe", line: "rule", node: "", enabled: true },
  {
    match: "chrome.exe",
    path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    line: "global",
    node: "n2",
    enabled: true,
    domains: ["openai.com"],
  },
  {
    match: "WeChat.exe",
    path: "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
    line: "direct",
    node: "",
    enabled: true,
  },
  { match: "node.exe", path: "D:\\nodejs\\node.exe", line: "line-us", node: "", enabled: false },
  {
    match: "C:\\Program Files\\ldplayer9box\\",
    path: "C:\\Program Files\\ldplayer9box\\",
    line: "global",
    node: "",
    enabled: true,
  },
];
const lines = [
  { id: "direct", name: "直连", node: "direct", routing: { mode: "global", rules: [] }, builtin: true },
  { id: "global", name: "全局", node: "active", routing: { mode: "global", rules: [] }, builtin: true },
  { id: "rule", name: "规则", node: "active", routing: { mode: "bypass_cn", rules: [] }, builtin: true },
  { id: "block", name: "拦截", node: "direct", routing: { mode: "global", rules: [] }, builtin: true },
  { id: "line-us", name: "美区-全局", node: "n2", routing: { mode: "global", rules: [] }, builtin: false },
];
const subs = [
  {
    id: "s1",
    name: "POWER云",
    url: "https://sub.example.com/power?token=abc",
    autoUpdate: true,
    lastUpdate: "2 小时前",
    nodeCount: 36,
  },
  { id: "s2", name: "备用订阅", url: "https://sub.example.com/b", autoUpdate: false, lastUpdate: "", nodeCount: 12 },
];
const settings = {
  mixedPort: 10808,
  tunMode: false,
  lanShare: true,
  excludeSelf: true,
  privateDirect: true,
  blockQUIC: true,
  remoteDNS: true,
  fakeIP: false,
  autostart: false,
  trayClose: true,
  theme: params.get("theme") ?? "light",
  lanPort: 7890,
  lanType: "mixed",
  lanUser: "",
  lanPass: "",
  autoUpdateApp: true,
};
const startedAt = Date.now();
let bytes = 0;
const status = () => {
  bytes += 900_000 + Math.random() * 600_000;
  return {
    coreRunning: true,
    engineRunning: true,
    corePort: 10808,
    nodeName: "JP | Tokyo - 01",
    selectedId: "n1",
    ruleMode: "whitelist",
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000) + 3720,
    stats: { running: true, activeConns: 24, totalConns: 310, tracked: 40, upBytes: bytes / 6, downBytes: bytes },
  };
};
const license = {
  enabled: true,
  signedIn: gate !== "login",
  authenticated: !gate,
  deviceLimitReached: gate === "member" || params.get("full") === "1",
  username: showcase ? "chen" : "xuan",
  features: [],
  expiresAt: "2027-06-01T00:00:00Z",
  offlineUntil: "2026-10-29T00:00:00Z",
  channel: "",
  ...licenseExtras, // 档位 / 设备 / 手机号（mock-sync.ts，?tier=free ?phone=0）
};
const mockOrder = (orderNo: string, amountCents: number) => ({
  orderNo,
  planName: "超级会员 · 年付",
  amountCents,
  currency: "CNY",
  status: "pending",
  payUrl: "https://pay.example",
  paidAt: "",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  createdAt: "",
});
const plan = (id: string, tier: string, name: string, days: number, cents: number, lifetime = false) => ({
  id,
  code: id,
  name,
  description: "",
  tier,
  billingCycle: "",
  durationDays: days,
  lifetime,
  priceCents: cents,
  originalPriceCents: lifetime ? cents * 2 : undefined,
  currency: "CNY",
  maxDevices: tier === "premium" ? 8 : 3,
  features: [],
  badge: "",
});
const release = {
  version: "1.10.0",
  minimumVersion: "1.9.51",
  url: "",
  sha256: "",
  signature: "",
  mandatory: update === "force",
  publishedAt: "",
};
const conns = [
  {
    process: "Code.exe",
    host: "api.githubcopilot.com",
    dest: "140.82.113.22:443",
    network: "tcp",
    rule: "process_name Code.exe",
    outbound: "JP | Tokyo - 01",
    outTag: "proxy",
    upload: 20480,
    download: 512000,
  },
  {
    process: "chrome.exe",
    host: "www.baidu.com",
    dest: "110.242.68.66:443",
    network: "tcp",
    rule: "rule_set geosite-cn",
    outbound: "直连",
    outTag: "direct",
    upload: 8192,
    download: 102400,
  },
  {
    process: "msedge.exe",
    host: "doubleclick.net",
    dest: "—",
    network: "tcp",
    rule: "rule_set geosite-ads",
    outbound: "拦截",
    outTag: "reject",
    upload: 0,
    download: 0,
  },
];
const ruleSets = [
  {
    name: "geosite-cn.srs",
    display: "国内网站 (geosite-cn)",
    desc: "识别大陆网站域名 → 直连不走代理",
    sizeKB: 52,
    modified: "2026-10-06",
    present: true,
    enabled: true,
  },
  {
    name: "geoip-cn.srs",
    display: "国内 IP (geoip-cn)",
    desc: "识别大陆 IP 段 → 直连不走代理",
    sizeKB: 33,
    modified: "2026-10-06",
    present: true,
    enabled: true,
  },
  {
    name: "geosite-category-ads-all.srs",
    display: "广告域名 (ads)",
    desc: "广告 / 追踪域名 → 直接拦截",
    sizeKB: 8,
    modified: "",
    present: false,
    enabled: false,
  },
];
const QR =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><path d='M0 0h3v3H0zM5 0h3v3H5zM0 5h3v3H0zM4 4h1v1H4zM6 5h2v1H6zM5 7h1v1H5z'/></svg>";

// 分流规则页：自定义规则 / 线路在本次预览里记住，保存后再读能看到改动。
let mockCustomRules: unknown[] = [{ type: "suffix", value: "zygskins.cn", action: "direct" }];
let mockLines: unknown[] = lines;
// 进程选择器：除已有规则的程序外，再多几个没添加的。
const extraProcs = [
  { name: "Discord.exe", path: "C:\\Users\\me\\AppData\\Local\\Discord\\app\\Discord.exe", count: 4, desc: "Discord" },
  { name: "Telegram.exe", path: "D:\\Apps\\Telegram\\Telegram.exe", count: 1, desc: "Telegram Desktop" },
];

const impl: Record<string, Fn> = {
  ...createPortsMock((id) => nodes.find((n) => n.id === id)?.name ?? id),
  ...createAppMonMock(),
  GetBootstrapState: () => ({
    ready: true,
    nodes,
    rules,
    lines,
    subs,
    settings,
    defaultLine: "rule",
    ruleMode: "whitelist",
    status: status(),
    license,
  }),
  GetStatus: status,
  GetHealth: () => ({ running: true, capturing: true, capturedPkts: 12873, warning: "", lines: [] }),
  GetConnections: () => conns,
  ...mockLink(conns.length),
  GetNodes: () => nodes,
  GetAppRules: () => rules,
  GetLines: () => mockLines,
  GetSubs: () => subs,
  GetSettings: () => settings,
  GetDefaultLine: () => "rule",
  GetRuleMode: () => "whitelist",
  GetClashMode: () => "rule",
  GetRuleSets: () => ruleSets,
  GetCustomRules: () => mockCustomRules,
  GetLicenseStatus: () => license,
  GetAppVersion: () => "1.9.74",
  GetCoreVersion: () => "1.13.14",
  GetLanIP: () => "192.168.1.23",
  // ?notes=1 预览升级后的「本次更新内容」弹窗
  GetUpdateNotes: () =>
    new URLSearchParams(previewSearch()).has("notes")
      ? [{ version: "1.9.77", items: ["新增「端口代理」，专门给指纹浏览器用。", "每次升级完成后先弹出本次更新内容。"] }]
      : [],
  MarkUpdateNotesSeen: () => undefined,
  TrackPage: () => undefined,
  GetLogLevel: () => "info",
  GetAutostart: () => true,
  ListProcesses: () => [
    ...rules.map((r) => ({ name: r.match, path: r.path, count: 3, desc: r.match.replace(".exe", "") })),
    ...extraProcs,
  ],
  GetAIControlInfo: () => ({
    url: "http://127.0.0.1:18088",
    token: "ps_8f2c1d9e0a7b4c3e",
    prompt: "你可以控制本机 ProxySplit…",
    mcpConfig: "{}",
    running: true,
  }),
  GetClaudeAccel: () => ({
    mode: "encode",
    manual: "",
    auto: true,
    enabled: true,
    reason: "落地签名验证通过，中继连通",
    rttMs: 42,
    gatewayInUse: false,
    stats: { requests: 120, relayed: 96, resumed: 1, reqBytes: 9_800_000, frameBytes: 310_000 },
  }),
  ...createAIMock(showcase),
  CheckAppUpdate: () => ({
    enabled: true,
    current: "1.9.74",
    available: !!update,
    release: update ? release : undefined,
  }),
  GetMembershipPlans: () => ({
    items: [
      plan("std-m", "standard", "普通会员 · 月付", 30, 1900),
      plan("std-y", "standard", "普通会员 · 年付", 365, 16800),
      plan("pre-m", "premium", "超级会员 · 月付", 30, 3900),
      plan("pre-y", "premium", "超级会员 · 年付", 365, 32800),
      plan("life", "premium", "超级会员 · 永久", 0, 59900, true),
    ],
  }),
  GetMyDevices: () => ({
    items: [
      {
        id: "d1",
        name: "XUAN-PC",
        platform: "Windows",
        appVersion: "1.9.74",
        firstSeenAt: "",
        lastSeenAt: new Date().toISOString(),
        current: true,
      },
      {
        id: "d2",
        name: "OFFICE-LAPTOP",
        platform: "Windows",
        appVersion: "1.9.70",
        firstSeenAt: "",
        lastSeenAt: "2026-10-18T09:00:00Z",
        current: false,
      },
    ],
  }),
  GetMyOrders: () => ({ items: [] }),
  GetFenxiao: (kind) => ({ data: mockFenxiao(params.get("fenxiao") === "0")[String(kind)] ?? { items: [], total: 0 } }),
  RequestFenxiaoWithdrawal: () => ({ data: { id: "9" } }),
  GetAnnouncements: () => ({
    items: [
      {
        id: "a1",
        type: "",
        title: "v1.9.74 已发布",
        summary: "Claude 加速兜底握手修复",
        content: "",
        version: "",
        pinned: false,
        publishedAt: "2026-10-22T00:30:00Z",
      },
    ],
  }),
  GetNodeShare: () => ({
    link: "vless://11111111-2222-3333-4444-555555555555@203.0.113.10:443?security=reality&type=tcp#%E7%A4%BA%E4%BE%8B%E8%8A%82%E7%82%B9",
    qr: QR,
    err: "",
  }),
  GetPaymentQR: () => ({ data: QR, err: "" }),
  CreateMembershipOrder: () =>
    params.get("split") === "1"
      ? { split: true, orders: [mockOrder("PS1a", 20000), mockOrder("PS1b", 12800)] }
      : { split: false, orders: [], order: mockOrder("PS1", 32800) },
  GetAppIcon: (path) => (showcase ? monogram(String(path)) : ""),
  TestApp: () => 66,
  TestLatency: () => 0,
  SpeedTest: () => ({ mbps: 11.2, err: "" }),
  SpeedTestNode: () => ({ mbps: 8.4, err: "" }),
  AddNodes: () => ({ added: 2, skipped: 1 }),
  TestTCP: () => new Promise((r) => setTimeout(() => r(""), 1200)),
  UpdateSub: () => new Promise((r) => setTimeout(() => r(""), 1200)),
  AddSub: (name: unknown, url: unknown, auto: unknown) => {
    subs.push({
      id: `s${Date.now()}`,
      name: String(name),
      url: String(url),
      autoUpdate: Boolean(auto),
      lastUpdate: "刚刚",
      nodeCount: 0,
    });
    return "";
  },
  PreviewAppRulesImport: () => ({
    summary: "4 条应用规则，新增 1 条线路",
    schemaVersion: 1,
    ruleCount: 4,
    lineAdded: 1,
    lineSkipped: 0,
    customRules: 1,
  }),
  PickExeFiles: () => [],
  AutoLoginPending: () => false,
  ExportAppRules: () => "{}",
  UpdateCore: () => "1.13.14",
  SetCustomRules: (list) => {
    mockCustomRules = list as unknown[];
    return "";
  },
  SetLines: (custom) => {
    mockLines = [...lines.filter((l) => l.builtin), ...(custom as unknown[])];
    return "";
  },
  SetNodeCore: (id, core) => mockSetNodeCore(nodes, id, core),
  ...mockReset,
  ...mockSync,
  SetRuleSetEnabled: (name, on) => {
    const rs = ruleSets.find((r) => r.name === name);
    if (rs) rs.enabled = !!on;
    return "";
  },
};

let logN = 0;
const listeners = new Map<string, Set<Fn>>();
export function installMockBackend(): void {
  const App = new Proxy(impl, {
    get:
      (t, k: string) =>
      async (...a: unknown[]) =>
        t[k] ? t[k](...a) : "",
  });
  // 只假事件：窗口方法（最小化 / 最大化…）保留 Wails 真运行时的（无边框窗口测试包里有），浏览器里没有就没有
  const real = (window as { runtime?: Record<string, unknown> }).runtime;
  Object.assign(window, {
    go: { main: { App } },
    runtime: {
      ...real,
      EventsOnMultiple: (name: string, cb: Fn) => {
        const set = listeners.get(name) ?? new Set<Fn>();
        set.add(cb);
        listeners.set(name, set);
        return () => set.delete(cb);
      },
    },
  });
  setInterval(() => {
    const msg = [
      "[core] 已连接到 JP | Tokyo - 01",
      "+0800 2026-10-22 12:34:56 INFO [rule] process_name Code.exe => proxy",
      "[service] 订阅更新超时，3 秒后重试",
    ][logN++ % 3];
    for (const cb of listeners.get("log") ?? []) cb(msg);
  }, 1500);
}
