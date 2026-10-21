// 界面用的领域类型：与 Go 端 JSON 一一对应（wailsjs/go/models.ts 是生成的类，这里用纯对象接口，界面可自由构造）。

export type Node = {
  id: string;
  name: string;
  type: string;
  server: string;
  port: number;
  network?: string;
  security?: string;
  /** Google 延迟：完整代理链路端到端；-99 检测中，<0 不通，0 未检测 */
  latency?: number;
  /** TCP 延迟：直连到节点边缘 */
  tcpLatency?: number;
  speed?: number;
};

export type Proc = { name: string; desc?: string; path: string; count: number };

/** 规则 / 全局 / 直连 / 拦截，或自定义线路 id */
export type AppRule = {
  match: string;
  path: string;
  line: string;
  /** rule/global 时走哪个节点；'' = 活动节点 */
  node?: string;
  enabled: boolean;
  domains?: string[];
  ips?: string[];
  ports?: string[];
};

export type RouteRule = { type: string; value: string; action: string };

export type Line = {
  id: string;
  name: string;
  /** 'active' 跟随活动节点 | 节点 id | 'direct' */
  node: string;
  routing: { mode: string; rules: RouteRule[] };
  builtin: boolean;
};

type LineHealth = { id: string; name: string; node: string; latency: number; ok: boolean };
export type Health = {
  running: boolean;
  capturing: boolean;
  capturedPkts: number;
  warning: string;
  lines: LineHealth[];
};

type CoreStats = {
  running?: boolean;
  activeConns: number;
  totalConns: number;
  tracked: number;
  upBytes: number;
  downBytes: number;
};

export type Status = {
  coreRunning: boolean;
  engineRunning: boolean;
  corePort: number;
  nodeName: string;
  selectedId: string;
  ruleMode: string;
  uptimeSec: number;
  stats?: CoreStats;
};

export type Sub = { id: string; name: string; url: string; autoUpdate: boolean; lastUpdate: string; nodeCount: number };

export type RuleSet = {
  name: string;
  display: string;
  desc: string;
  sizeKB: number;
  modified: string;
  present: boolean;
  enabled: boolean;
};

export type RuleImportPreview = {
  schemaVersion: number;
  ruleCount: number;
  lineAdded: number;
  lineSkipped: number;
  customRules: number;
  summary: string;
  error?: string;
};

export type Settings = {
  mixedPort: number;
  tunMode: boolean;
  lanShare: boolean;
  excludeSelf: boolean;
  privateDirect: boolean;
  blockQUIC: boolean;
  remoteDNS: boolean;
  fakeIP: boolean;
  autostart: boolean;
  trayClose: boolean;
  theme: string;
  lanPort: number;
  lanType: string;
  lanUser: string;
  lanPass: string;
  autoUpdateApp: boolean;
  autoUpdateCoreOff?: boolean;
  claudeAccelOff?: boolean;
  claudeAccelAutoOff?: boolean;
};

export type LicenseStatus = {
  enabled: boolean;
  signedIn: boolean;
  authenticated: boolean;
  deviceLimitReached: boolean;
  username: string;
  plan: string;
  planCode: string;
  tier: string;
  maxDevices: number;
  features: string[];
  expiresAt: string;
  offlineUntil: string;
  channel?: string;
  error?: string;
};

export type MemberPlan = {
  id: string;
  code: string;
  name: string;
  description: string;
  tier: string;
  billingCycle: string;
  durationDays?: number;
  lifetime: boolean;
  priceCents: number;
  originalPriceCents?: number;
  currency: string;
  maxDevices: number;
  features: string[];
  badge: string;
  saleEndsAt?: string;
};

export type AccountDevice = {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  firstSeenAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type MemberOrder = {
  orderNo: string;
  planName: string;
  amountCents: number;
  currency: string;
  status: string;
  payUrl: string;
  checkoutUrl?: string;
  paidAt: string;
  expiresAt: string;
  createdAt: string;
};

export type Announcement = {
  id: string;
  type: string;
  title: string;
  summary: string;
  content: string;
  version: string;
  pinned: boolean;
  publishedAt: string;
};

type AppRelease = {
  version: string;
  minimumVersion: string;
  url: string;
  sha256: string;
  signature: string;
  mandatory: boolean;
  publishedAt: string;
};

export type AppUpdateStatus = {
  enabled: boolean;
  current: string;
  available: boolean;
  release?: AppRelease;
  error?: string;
};

export type Conn = {
  process: string;
  path?: string;
  host: string;
  dest: string;
  network: string;
  rule: string;
  outbound: string;
  outTag: string;
  upload: number;
  download: number;
};

export type AIControlInfo = { url: string; token: string; prompt: string; mcpConfig: string; running: boolean };

export type AccelState = {
  mode: string;
  manual: string;
  auto: boolean;
  enabled: boolean;
  reason: string;
  rttMs: number;
  gatewayInUse: boolean;
  stats?: { requests: number; relayed: number; resumed: number; reqBytes: number; frameBytes: number };
};

export type AIEnvItem = {
  id: string;
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  detail: string;
  fix?: string;
};
export type AIEnvReport = { items: AIEnvItem[]; exitIp?: string; exitLoc?: string; checkedAt: string };
export type AIHijack = { on: boolean; locked: boolean; visible: boolean };

export type BootstrapState = {
  ready?: boolean;
  error?: string;
  nodes?: Node[];
  rules?: AppRule[];
  lines?: Line[];
  subs?: Sub[];
  settings?: Settings;
  defaultLine?: string;
  ruleMode?: string;
  status?: Status;
  license?: LicenseStatus;
};

/** 分流模式：只代理列出的（白名单，默认）/ 默认全代理（黑名单） */
export type RuleMode = "whitelist" | "blacklist";
/** 代理策略（clash mode，切换不重启） */
export type ClashMode = "rule" | "global" | "direct";
