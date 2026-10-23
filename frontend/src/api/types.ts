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
  /** 端口代理的连接才有：内核连接 id / 来访客户端 IP / 开始时间（RFC3339） */
  id?: string;
  source?: string;
  start?: string;
};

export type PortProtocol = "mixed" | "socks" | "http";
export type PortMode = "rule" | "global" | "direct";

/** 端口代理：一个本地监听端口 = 一条独立线路（自己的内核进程）。 */
export type ProxyPort = {
  id: string;
  name: string;
  enabled: boolean;
  port: number;
  protocol: PortProtocol;
  /** true = 0.0.0.0 局域网可连，false = 仅 127.0.0.1 */
  lan: boolean;
  user: string;
  pass: string;
  mode: PortMode;
  /** 节点 id，'' = 当前选中的节点 */
  node: string;
};

export type PortClient = {
  ip: string;
  conns: number;
  total: number;
  upload: number;
  download: number;
  firstSeen: string;
  lastSeen: string;
};

export type ProxyPortStatus = ProxyPort & {
  running: boolean;
  error?: string;
  nodeName: string;
  conns: number;
  upload: number;
  download: number;
  clients: PortClient[];
};

export type PortAccess = {
  time: string;
  client: string;
  host: string;
  network: string;
  outbound: string;
  rule: string;
};

export type PortDetail = { conns: Conn[]; access: PortAccess[]; logs: string[] };

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
export type AIEnvReport = {
  items: AIEnvItem[];
  exitIp?: string;
  exitLoc?: string;
  exitKind?: string;
  exitAsn?: string;
  exitOurs: boolean;
  checkedAt: string;
};
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

/** 应用库条目：一个应用 = 多个进程（内置模拟器等 + 用户自定义） */
export type CatalogApp = {
  id: string;
  name: string;
  category: string;
  processes: string[];
  note?: string;
  builtin: boolean;
  /** 本机检测到的安装目录（目录下所有程序都算这个应用）；自定义应用里用户填的目录 */
  dirs?: string[];
};

/** idle 还没流量 · ok 连接正常 · warn 部分失败 · fail 全部失败 */
export type AppHealth = "idle" | "ok" | "warn" | "fail";

export type AppStat = {
  process: string;
  health: AppHealth;
  live: number;
  total: number;
  ok: number;
  /** 很快结束、没来得及看到流量，也没报错 */
  done: number;
  failed: number;
  upload: number;
  download: number;
  lastSeen?: string;
  lastOk?: string;
  lastFail?: string;
  lastHost?: string;
  lastExit?: string;
};

export type AppAccess = {
  time: string;
  host: string;
  network: string;
  outbound: string;
  rule: string;
  /** 进行中 / 成功 / 完成 / 失败 / 拦截 */
  status: string;
  /** 失败原因（内核报错或无响应）或拦截说明 */
  reason?: string;
  /** 发起这条连接的程序 */
  process: string;
  path?: string;
  /** 持续了多久（秒） */
  seconds: number;
  upload: number;
  download: number;
};

/** 应用里真正联网的程序（整目录应用会有多个） */
export type ProcStat = {
  process: string;
  path?: string;
  total: number;
  failed: number;
  download: number;
  lastSeen?: string;
};

/** 按访问目标汇总，失败的排前面 */
export type HostStat = {
  host: string;
  conns: number;
  live: number;
  ok: number;
  done: number;
  failed: number;
  blocked: number;
  upload: number;
  download: number;
  exit: string;
  network: string;
  lastSeen: string;
  lastError: string;
  seconds: number;
};

export type AppDetail = {
  stat: AppStat;
  processes: ProcStat[];
  hosts: HostStat[];
  access: AppAccess[];
  logs: string[];
};

export type RouteTestResult = {
  process: string;
  url: string;
  ok: boolean;
  httpCode: number;
  seconds: number;
  error?: string;
  route: string;
  hops: { host: string; dest?: string; rule?: string; outTag: string; outbound?: string }[];
  note?: string;
};

/** 环境配置的一项（pkg/aienv.Status）。target 为空 = 只作说明。 */
export type EnvItem = {
  id: string;
  name: string;
  current: string;
  target: string;
  done: boolean;
  configured: boolean;
  restorable: boolean;
  note: string;
};
