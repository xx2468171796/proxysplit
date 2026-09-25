<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import brandIcon from './assets/proxysplit-logo.svg'
  import {
    AddNodes as WAddNodes,
    AddManualNode as WAddManualNode,
    GetNodes as WGetNodes,
    GetBootstrapState as WGetBootstrapState,
    RemoveNode as WRemoveNode,
    SelectNode as WSelectNode,
    ListProcesses as WListProcesses,
    Start as WStart,
    Stop as WStop,
    Restart as WRestart,
    GetStatus as WGetStatus,
    GetAppRules as WGetAppRules,
    SetAppRules as WSetAppRules,
    GetRuleMode as WGetRuleMode,
    SetRuleMode as WSetRuleMode,
    TestLatency as WTestLatency,
    TestTCP as WTestTCP,
    TestAllLatency as WTestAllLatency,
    GetAppIcon as WGetAppIcon,
    GetSubs as WGetSubs,
    AddSub as WAddSub,
    EditSub as WEditSub,
    UpdateSub as WUpdateSub,
    RemoveSub as WRemoveSub,
    SetSubAutoUpdate as WSetSubAutoUpdate,
    GetCoreVersion as WGetCoreVersion,
    UpdateCore as WUpdateCore,
    GetSettings as WGetSettings,
    SetSettings as WSetSettings,
    GetRouting as WGetRouting,
    UpdateRuleSets as WUpdateRuleSets,
    GetLines as WGetLines,
    SetLines as WSetLines,
    GetDefaultLine as WGetDefaultLine,
    SetDefaultLine as WSetDefaultLine,
    GetClashMode as WGetClashMode,
    SetClashMode as WSetClashMode,
    GetSystemProxy as WGetSystemProxy,
    SpeedTest as WSpeedTest,
    SpeedTestNode as WSpeedTestNode,
    OpenWebsite as WOpenWebsite,
    OpenGitHub as WOpenGitHub,
    CopyToClipboard as WCopyToClipboard,
    GetNodeQR as WGetNodeQR,
    GetAutostart as WGetAutostart,
    SetAutostart as WSetAutostart,
    GetLogLevel as WGetLogLevel,
    SetLogLevel as WSetLogLevel,
    ExportAppRules as WExportAppRules,
    ImportAppRules as WImportAppRules,
    PreviewAppRulesImport as WPreviewAppRulesImport,
    GetLanIP as WGetLanIP,
    GetAIControlInfo as WGetAIControlInfo,
    PickExeFiles as WPickExeFiles,
    TestApp as WTestApp,
    ExportConfig as WExportConfig,
    ImportConfig as WImportConfig,
    GetHealth as WGetHealth,
    GetConnections as WGetConnections,
    GetRuleSets as WGetRuleSets,
    SetRuleSetEnabled as WSetRuleSetEnabled,
    ResetConfig as WResetConfig,
    GetCustomRules as WGetCustomRules,
    SetCustomRules as WSetCustomRules,
    GetLicenseStatus as WGetLicenseStatus,
    Login as WLogin,
    Logout as WLogout,
    CheckAppUpdate as WCheckAppUpdate,
    InstallAppUpdate as WInstallAppUpdate,
    GetAppVersion as WGetAppVersion,
    Register as WRegister,
    GetMembershipPlans as WGetMembershipPlans,
    GetMyDevices as WGetMyDevices,
    UnbindMyDevice as WUnbindMyDevice,
    ActivateCurrentDevice as WActivateCurrentDevice,
    GetMyOrders as WGetMyOrders,
    CreateMembershipOrder as WCreateMembershipOrder,
    GetPaymentQR as WGetPaymentQR,
    OpenPaymentURL as WOpenPaymentURL,
    GetAnnouncements as WGetAnnouncements,
    RefreshEntitlement as WRefreshEntitlement,
    RedeemCode as WRedeemCode,
    ChangeAccountPassword as WChangeAccountPassword,
  } from '../wailsjs/go/main/App.js'
  import { EventsOn } from '../wailsjs/runtime/runtime.js'
  import donateQR from './assets/images/donate.png'

  type Tab = 'overview' | 'nodes' | 'apps' | 'rules' | 'subs' | 'logs' | 'settings'
  const tabMeta: Record<Tab, { title: string; desc: string }> = {
    overview: { title: '概览', desc: '运行状态与快捷控制' },
    nodes: { title: '节点', desc: '节点导入、测速与选择' },
    apps: { title: '应用分流', desc: '按程序分配线路与策略' },
    rules: { title: '分流规则', desc: '规则库、自定义规则与线路' },
    subs: { title: '订阅', desc: '订阅源与节点同步' },
    logs: { title: '日志', desc: '内核与连接运行记录' },
    settings: { title: '设置', desc: '网络、系统集成与维护' },
  }
  type RuleSet = { name: string; display: string; desc: string; sizeKB: number; modified: string; present: boolean; enabled: boolean }
  type Node = {
    id: string
    name: string
    type: string
    server: string
    port: number
    network?: string
    security?: string
    latency?: number // Google 延迟(完整代理链路 end-to-end)
    tcpLatency?: number // TCP 延迟(到节点边缘的传输层可达性)
    speed?: number
    region?: string // color key for the flag dot
  }
  type Proc = { name: string; desc?: string; path: string; count: number }
  type AppRule = {
    match: string
    path: string
    line: string // 规则/全局/直连/拦截 (rule/global/direct/block)
    node?: string // node id for rule/global apps; '' = active/selected node
    enabled: boolean
    domains?: string[] // 可选目标条件：域名后缀
    ips?: string[]     // IP / CIDR
    ports?: string[]   // 端口 / 端口段
  }
  type Line = {
    id: string
    name: string
    node: string // 'active' (跟随活动节点) | node id | 'direct'
    routing: { mode: string; rules: RouteRule[] } // mode: 'global' | 'bypass_cn' | 'custom'
    builtin: boolean
  }
  type LineHealth = { id: string; name: string; node: string; latency: number; ok: boolean }
  type Health = { running: boolean; capturing: boolean; capturedPkts: number; warning: string; lines: LineHealth[] }
  type LogItem = { time: string; level: 'INFO' | 'WARN' | 'ERROR'; msg: string }
  type Status = {
    coreRunning: boolean
    engineRunning: boolean
    corePort: number
    nodeName: string
    selectedId: string
    ruleMode: string
    uptimeSec: number
    stats?: { running?: boolean; activeConns: number; totalConns: number; tracked: number; upBytes: number; downBytes: number }
  }
  type BootstrapState = {
    ready?: boolean; error?: string
    nodes?: Node[]; rules?: AppRule[]; lines?: Line[]; subs?: Sub[]; settings?: Settings
    defaultLine?: string; ruleMode?: string; status?: Status; license?: LicenseStatus
  }
  type Sub = { id: string; name: string; url: string; autoUpdate: boolean; lastUpdate: string; nodeCount: number }
  type RouteRule = { type: string; value: string; action: string }
  type RuleImportPreview = { schemaVersion: number; ruleCount: number; lineAdded: number; lineSkipped: number; customRules: number; summary: string; error?: string }
  type Routing = { enabled: boolean; mode: string; rules: RouteRule[] }
  type LicenseStatus = { enabled: boolean; signedIn: boolean; authenticated: boolean; deviceLimitReached: boolean; username: string; plan: string; planCode: string; tier: string; maxDevices: number; features: string[]; expiresAt: string; offlineUntil: string; error?: string }
  type MemberPlan = { id: string; code: string; name: string; description: string; tier: string; billingCycle: string; durationDays?: number; lifetime: boolean; priceCents: number; originalPriceCents?: number; currency: string; maxDevices: number; features: string[]; badge: string; saleEndsAt?: string }
  type AccountDevice = { id: string; name: string; platform: string; appVersion: string; firstSeenAt: string; lastSeenAt: string; current: boolean }
  type MemberOrder = { orderNo: string; planName: string; amountCents: number; currency: string; status: string; payUrl: string; paidAt: string; expiresAt: string; createdAt: string }
  type Announcement = { id: string; type: string; title: string; summary: string; content: string; version: string; pinned: boolean; publishedAt: string }
  type AppRelease = { version: string; minimumVersion: string; url: string; sha256: string; signature: string; mandatory: boolean; publishedAt: string }
  type AppUpdateStatus = { enabled: boolean; current: string; available: boolean; release?: AppRelease; error?: string }
  type Settings = {
    mixedPort: number; tunMode: boolean; lanShare: boolean; excludeSelf: boolean; privateDirect: boolean; blockQUIC: boolean
    remoteDNS: boolean; fakeIP: boolean; autostart: boolean; trayClose: boolean; theme: string
    lanPort: number; lanType: string; lanUser: string; lanPass: string; autoUpdateRules: boolean; autoUpdateApp: boolean
  }

  // --- demo data (matches the design mockup 1:1, shown in browser preview) ---
  // 正式端未就绪时保持空态，绝不把样例节点当作真实代理展示。
  const demoNodes: Node[] = []
  const demoRules: AppRule[] = []
  const demoLines: Line[] = [
    { id: 'direct', name: '直连', node: 'direct', routing: { mode: 'global', rules: [] }, builtin: true },
    { id: 'global', name: '全局', node: 'active', routing: { mode: 'global', rules: [] }, builtin: true },
    { id: 'rule', name: '规则', node: 'active', routing: { mode: 'bypass_cn', rules: [] }, builtin: true },
    { id: 'block', name: '拦截', node: 'direct', routing: { mode: 'global', rules: [] }, builtin: true },
    { id: 'us', name: '美区-全局', node: 'us', routing: { mode: 'global', rules: [] }, builtin: false },
  ]
  const demoLogs: LogItem[] = [
    { time: '12:34:56', level: 'INFO', msg: '已连接到 JP | Tokyo - 01' },
    { time: '12:34:55', level: 'INFO', msg: '核心已启动 (sing-box 1.13.14)' },
    { time: '12:34:55', level: 'INFO', msg: '应用分流规则已加载 (5 条)' },
    { time: '12:34:53', level: 'WARN', msg: '订阅更新失败: 超时' },
    { time: '12:34:52', level: 'INFO', msg: '开始更新订阅...' },
    { time: '12:34:50', level: 'INFO', msg: '切换节点: US | Los Angeles - 02' },
    { time: '12:34:48', level: 'INFO', msg: '代理服务已停止' },
  ]
  const demoStatus: Status = {
    coreRunning: false, engineRunning: false, corePort: 10808,
    nodeName: '', selectedId: '', ruleMode: 'whitelist', uptimeSec: 0,
    stats: { activeConns: 0, totalConns: 0, tracked: 0, upBytes: 0, downBytes: 0 },
  }
  const demoSubs: Sub[] = [
    { id: 'a', name: '机场订阅 A', url: 'https://sub.example.com/a', autoUpdate: true, lastUpdate: '2 小时前', nodeCount: 36 },
    { id: 'b', name: '备用订阅', url: 'https://sub.example.com/b', autoUpdate: false, lastUpdate: '手动', nodeCount: 12 },
  ]
  const demoSettings: Settings = {
    mixedPort: 10808, tunMode: false, lanShare: false, excludeSelf: true, privateDirect: true, blockQUIC: true,
    remoteDNS: true, fakeIP: false, autostart: false, trayClose: true, theme: 'light',
    lanPort: 7890, lanType: 'mixed', lanUser: '', lanPass: '', autoUpdateRules: false, autoUpdateApp: true,
  }

  let tab: Tab = 'overview'
  let nodes: Node[] = []
  let rules: AppRule[] = []
  let lines: Line[] = []
  let defaultLine = 'rule'
  let subs: Sub[] = []
  let settings: Settings = { ...demoSettings }
  let routing: Routing = { enabled: true, mode: 'global', rules: [] }
  let logs: string[] = []
  let recent: LogItem[] = []
  let status: Status | null = null
  let license: LicenseStatus = { enabled: false, signedIn: false, authenticated: true, deviceLimitReached: false, username: '', plan: '', planCode: '', tier: '', maxDevices: 0, features: [], expiresAt: '', offlineUntil: '' }
  let loginForm = { username: '', email: '', password: '' }
  let authMode: 'login' | 'register' = 'login'
  let loginBusy = false
  let loginError = ''
  let memberPlans: MemberPlan[] = []
  let accountDevices: AccountDevice[] = []
  let memberOrders: MemberOrder[] = []
  let announcements: Announcement[] = []
  let commerceBusy = false
  let commerceLoading = false
  let commerceError = ''
  let deviceLoadError = ''
  let planLoadError = ''
  let showMembership = false
  let membershipPrompted = false
  let commerceTimer: ReturnType<typeof setInterval> | null = null
  let appUpdateTimer: ReturnType<typeof setInterval> | null = null
  let activeOrder: MemberOrder | null = null
  let paymentQR = ''
  // 拆单分付：超限订单拆成多笔，顺序支付（付完一笔自动切下一笔的二维码）。
  let splitOrders: MemberOrder[] = []
  let splitIdx = 0
  let redeemInput = ''
  let redeemBusy = false
  let pwCurrent = '', pwNext = '', pwBusy = false, pwMsg = '', pwErr = false
  let showRedeemDialog = false
  let paymentPoll: ReturnType<typeof setInterval> | null = null
  let paymentPollVis: (() => void) | null = null
  let paymentPollBusy = false
  let entitlementRecoveryOrder = ''
  let ruleMode: 'blacklist' | 'whitelist' = 'whitelist' // 只代理列出的（默认/推荐）
  let linkText = ''
  let addMsg = ''
  let query = ''
  let newApp = ''
  let procs: Proc[] = []
  let liveProcs: Proc[] = []
  let procFilter = ''
  let showPicker = false
  let busy = false
  let logFilter = ''
  let showSubForm = false
  let subName = ''
  let subUrl = ''
  let subAuto = false
  let subMsg: Record<string, string> = {} // per-row update status keyed by sub id
  let editingSubId = ''
  let editSubName = ''
  let editSubUrl = ''
  let coreVersion = '1.13.14'
  let coreMsg = ''
  let appUpdate: AppUpdateStatus = { enabled: false, current: 'dev', available: false }
  let appUpdateBusy = false
  let ruleSetMsg = ''
  let showLineForm = false
  let lineForm: { id: string; name: string; node: string; mode: string; rules: RouteRule[] } = { id: '', name: '', node: 'active', mode: 'global', rules: [] }
  let clashMode = 'rule' // 'rule' | 'global' | 'direct' — 主控:流量走向 (no restart)
  let sysProxy = false // Windows system proxy on/off
  let speedMsg = '' // download speed test result / status
  let speedTesting = false
  let latencyTesting = false
  let latencyTestingId = '' // node id whose 测 Google is running
  let tcpTestingId = ''     // node id whose 测 TCP is running
  let speedTestingId = ''   // node id whose 测速度 is running
  let qrData = '' // PNG data URI for the QR overlay ('' = hidden)
  let qrName = ''
  // 赞赏码：每次启动强制弹出，先倒计时 3 秒（期间不可关闭），倒计时结束后
  // 才出现「关闭」按钮，且只能由用户手动点击关闭，不点则一直保留、绝不自动消失。
  let showDonate = false
  let donateLeft = 3 // 关闭前必须停留的秒数；>0 时关闭按钮禁用
  let donateTimer: ReturnType<typeof setInterval> | null = null
  let autostart = false // 开机自启 (real, registry-backed)
  let logLevel = 'info' // core log verbosity
  let lanIP = '' // this machine's LAN IP (for the 对局域网开放 hint)
  let appLat: Record<string, number> = {} // rule.match -> latency ms (-99 testing, -1 fail, 0 direct, -2 block)
  let runningExes = new Set<string>() // lowercased basenames of currently-running processes
  let health: Health = { running: false, capturing: false, capturedPkts: 0, warning: '', lines: [] }
  // 实时连接诊断：每条连接命中的规则与最终出口（来自 sing-box clash_api /connections）
  type Conn = { process: string; host: string; dest: string; network: string; rule: string; outbound: string; outTag: string; upload: number; download: number }
  let conns: Conn[] = []
  let connFilter = ''
  let warnDismissed = '' // the warning text the user dismissed (hide banner until it changes)
  let ruleSets: RuleSet[] = [] // routing rule-sets (geosite/geoip) for the 规则 page
  let themePref = 'light' // 'light' | 'dark' | 'system'
  let switchingMode = false // guard while TUN<->app-split restart is in flight
  let rulesMsg = '' // import/export status
  let iconMap: Record<string, string> = {}
  const iconPending = new Set<string>()
  let prevDown = 0, prevUp = 0, prevT = 0
  let downRate = 0, upRate = 0 // bytes/sec (formatted adaptively for display)
  let timer: ReturnType<typeof setInterval> | null = null
  let dataRetryTimer: ReturnType<typeof setInterval> | null = null
  let dataReloading = false
  let bootstrapLoaded = false
  let useDemo = false

  // Obfuscated Wails releases intentionally replace window.go.main.App with a
  // generated numeric dispatcher. Its global name/runtime shape is not a
  // stable public contract, so probing either namespace can incorrectly report
  // "not ready" even though every generated binding is callable. Calls made
  // before bridge attachment already reject and are handled by safe()/the
  // surrounding try/catch, therefore only guard SSR here.
  const isWailsReady = () => typeof window !== 'undefined'
  async function safe<T>(call: () => Promise<T>, fallback: T): Promise<T> {
    if (!isWailsReady()) { if (!bootstrapLoaded) useDemo = true; return fallback }
    // A transient backend error must NOT flip the whole app into demo mode.
    // Also coerce null/undefined to the fallback: Go marshals a nil slice to
    // JSON `null`, and a null reaching a {#each}/.length throws inside Svelte's
    // flush(), which re-throws without clearing update_scheduled and wedges the
    // scheduler → the whole UI freezes. `?? fallback` keeps 0/false/'' intact.
    try { const r = await call(); return r ?? fallback } catch (e) { console.warn('[ProxySplit] call failed', e); return fallback }
  }

  function normalizeRules(list: AppRule[] | null | undefined): AppRule[] {
    return (list ?? []).map((r) => ({
      match: r.match, path: r.path,
      line: ['global', 'direct', 'block'].includes(r.line) ? r.line : 'rule',
      node: r.node || '', enabled: !!r.enabled,
      domains: r.domains ?? [], ips: r.ips ?? [], ports: r.ports ?? [],
    }))
  }
  // 目标条件：逗号/空格/换行分隔的文本 <-> 字符串数组
  function parseList(s: string): string[] {
    return s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
  }
  function hasScope(r: AppRule): boolean {
    return (r.domains?.length || r.ips?.length || r.ports?.length) ? true : false
  }
  let scopeOpen: Record<number, boolean> = {}
  function toggleScope(i: number) { scopeOpen[i] = !scopeOpen[i]; scopeOpen = scopeOpen }

  // The Go OnDomReady hook writes this snapshot to a window global and emits
  // an event.  This server-push path is independent from the initial Wails RPC
  // timing, which is important on slower WebView2 starts.
  function applyBootstrap(s: BootstrapState | null | undefined): boolean {
    if (!s || typeof s !== 'object' || s.ready !== true) {
      if (s?.error) console.error('[ProxySplit] backend startup failed:', s.error)
      return false
    }
    nodes = s.nodes ?? []
    rules = normalizeRules(s.rules)
    lines = s.lines ?? []
    subs = s.subs ?? []
    if (s.settings) settings = s.settings
    defaultLine = s.defaultLine || 'rule'
    if (s.status) status = s.status
    if (s.license) license = s.license
    ruleMode = s.ruleMode === 'blacklist' ? 'blacklist' : 'whitelist'
    bootstrapLoaded = true
    useDemo = false
    // The first reactive icon pass may have run before the Wails bridge was
    // attached.  Run it again after the real bootstrap snapshot arrives so
    // application rules always request the Windows shell icon, never a
    // synthetic client-side icon.
    queueOriginalIcons()
    return true
  }
  const onBootstrap = (event: Event) => applyBootstrap((event as CustomEvent<BootstrapState>).detail)

  // This is the only RPC used for the first load. The Go method waits on the
  // backend readiness barrier, so its promise cannot be orphaned by a nil
  // service panic and it can never turn an initialization race into an empty UI.
  async function loadBootstrap(): Promise<boolean> {
    if (bootstrapLoaded) return true
    if (!isWailsReady()) return false
    try {
      return applyBootstrap(await WGetBootstrapState() as BootstrapState)
    } catch (e) {
      console.warn('[ProxySplit] bootstrap load failed; will retry', e)
      return false
    }
  }

  $: running = !!status && (status.coreRunning || status.engineRunning)
  $: currentTabMeta = tabMeta[tab]
  $: ruleCount = rules.length
  $: proxyCount = rules.filter((r) => r.enabled && r.line !== 'direct' && r.line !== 'block').length
  $: filteredProcs = procs.filter((p) => {
    const t = `${p.name} ${p.path}`.toLowerCase()
    return !procFilter || t.includes(procFilter.toLowerCase())
  })
  $: visibleLogs = logs.filter((l) => !logFilter || l.toLowerCase().includes(logFilter.toLowerCase()))
  $: parsedLogs = visibleLogs.map(parseLog)
  $: dn = useDemo ? { v: '12.45', u: 'MB/s' } : fmtRate(downRate)
  $: up = useDemo ? { v: '2.34', u: 'MB/s' } : fmtRate(upRate)
  $: activeConns = status?.stats?.activeConns ?? (useDemo ? 24 : 0)
  $: uptime = running ? fmtUptime(status?.uptimeSec ?? 0) : '00:00:00'
  $: rules.forEach((r) => loadIcon(ruleIconPath(r)))
  $: filteredProcs.forEach((p) => loadIcon(p.path))

  // Adaptive rate formatter so slow traffic reads precisely (KB/s, B/s) instead
  // of rounding to 0.00 MB/s.
  function fmtRate(bps: number): { v: string; u: string } {
    if (!(bps > 0)) return { v: '0.00', u: 'MB/s' }
    if (bps >= 1024 * 1024) return { v: (bps / 1048576).toFixed(2), u: 'MB/s' }
    if (bps >= 1024) return { v: (bps / 1024).toFixed(1), u: 'KB/s' }
    return { v: Math.round(bps).toString(), u: 'B/s' }
  }
  function fmtUptime(secs: number) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
    return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':')
  }
  // Split a raw log line into time / level / tag / message so the log renders as
  // clean, colored, left-aligned columns instead of a wall of text.
  function parseLog(raw: string): { time: string; level: string; tag: string; msg: string } {
    const s = raw.replace(/\s+$/, '')
    const tmMatch = s.match(/(\d{2}:\d{2}:\d{2})/)
    const time = tmMatch ? tmMatch[1] : ''
    // drop any leading timestamp block(s) so the message body starts clean
    let body = s
      .replace(/^\s*[+\-]?\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, '')
      .replace(/^\s*[+\-]\d{4}\s+/, '')
      .replace(/^\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, '')
    const lvMatch = body.match(/^\s*(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|PANIC)\b/i)
    let level = lvMatch ? lvMatch[1].toUpperCase() : ''
    if (level) body = body.slice(lvMatch![0].length)
    body = body.replace(/^[:\s]+/, '')
    let tag = ''
    const tgMatch = body.match(/^\[([^\]]+)\]\s*/)
    if (tgMatch) { tag = tgMatch[1]; body = body.slice(tgMatch[0].length) }
    let msg = body.trim() || s.trim()
    // infer a level for coloring when the core did not print one (our own logs)
    if (!level) {
      if (/error|fail|失败|拒绝|无法|panic/i.test(msg)) level = 'ERROR'
      else if (/warn|warning|超时|timeout|重试|抓不到/i.test(msg)) level = 'WARN'
      else level = 'INFO'
    }
    if (level === 'WARNING') level = 'WARN'
    return { time, level, tag, msg }
  }
  function ruleName(r: AppRule): string {
    const m = r.match || r.path || '?'
    return /[\\/]/.test(m) ? (m.split(/[\\/]/).pop() || m) : m
  }
  function ruleIcon(r: AppRule): string {
    const path = ruleIconPath(r)
    if (path && iconMap[path]) return iconMap[path]
    const exe = baseName(r.match || r.path).toLowerCase()
    const live = liveProcs.find((p) => baseName(p.path || p.name).toLowerCase() === exe)
    return live ? (iconMap[live.path] || '') : ''
  }
  // 规则可能只保存 exe 名而没有完整路径；优先用运行中进程的真实路径，才能提取原始 EXE 图标。
  function ruleIconPath(r: AppRule): string {
    if (r.path && /\.exe$/i.test(r.path)) return r.path
    const exe = baseName(r.match || r.path).toLowerCase()
    return liveProcs.find((p) => baseName(p.path || p.name).toLowerCase() === exe)?.path || r.path || ''
  }
  async function loadIcon(path: string) {
    if (!path || path in iconMap || iconPending.has(path)) return
    if (useDemo || !isWailsReady()) return
    iconPending.add(path)
    try {
      const uri = await WGetAppIcon(path)
      iconMap = { ...iconMap, [path]: uri || '' }
    } catch { iconMap = { ...iconMap, [path]: '' } }
    iconPending.delete(path)
  }
  function queueOriginalIcons() {
    if (useDemo || !isWailsReady()) return
    rules.forEach((r) => loadIcon(ruleIconPath(r)))
    procs.forEach((p) => loadIcon(p.path))
    liveProcs.forEach((p) => loadIcon(p.path))
  }

  // Persist the AppRule[] model straight to the backend.
  let savedMsg = ''
  async function pushRules() {
    if (useDemo || !isWailsReady()) return
    const err = await WSetAppRules(rules)
    if (err) { savedMsg = '保存失败：' + err; setTimeout(() => (savedMsg = ''), 3500); return }
    savedMsg = running ? '✓ 已保存,已实时生效' : '✓ 已自动保存'
    setTimeout(() => (savedMsg = ''), 1800)
  }

  async function refreshNodes() { nodes = await safe(() => WGetNodes() as Promise<Node[]>, demoNodes) }
  async function refreshStatus() {
    status = await safe(() => WGetStatus() as Promise<Status>, demoStatus)
    const s = status?.stats
    const now = Date.now()
    if (!s?.running) {
      downRate = 0; upRate = 0
      prevDown = 0; prevUp = 0; prevT = 0
      return
    }
    if (prevT) {
      const dt = (now - prevT) / 1000
      if (dt > 0) {
        // sing-box counters restart from zero whenever the core restarts.
        // Treat a decrease as a new baseline instead of showing a giant spike.
        downRate = s.downBytes >= prevDown ? (s.downBytes - prevDown) / dt : 0
        upRate = s.upBytes >= prevUp ? (s.upBytes - prevUp) / dt : 0
      }
    }
    prevDown = s.downBytes; prevUp = s.upBytes; prevT = now
  }
  async function refreshAll() {
    await Promise.all([refreshStatus(), refreshHealth(), refreshNodes(), refreshRules(), refreshLines(), refreshSubs()])
  }
  function nodeName(id: string): string { return nodes.find((n) => n.id === id)?.name || id }
  function remainingLabel(expiresAt: string, planCode = '') {
    if (planCode.includes('lifetime') || planCode === 'admin') return '永久有效'
    if (!expiresAt) return '未开通'
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (!Number.isFinite(ms) || ms <= 0) return '已到期'
    const days = Math.floor(ms / 86_400_000)
    const hours = Math.max(1, Math.ceil((ms % 86_400_000) / 3_600_000))
    return days > 0 ? `剩余 ${days} 天 ${hours} 小时` : `剩余 ${hours} 小时`
  }
  function tierPlan(tier: string) { return memberPlans.find(plan => plan.tier === tier) }
  $: membershipRemaining = remainingLabel(license.expiresAt, license.planCode)
  $: membershipIdentity = license.plan || (license.signedIn ? '未开通会员' : '未登录')
  $: standardReference = tierPlan('standard')
  $: premiumReference = tierPlan('premium')
  $: standardPlans = memberPlans.filter((plan) => plan.tier === 'standard')
  $: premiumPlans = memberPlans.filter((plan) => plan.tier === 'premium' && !plan.lifetime)
  $: lifetimePlans = memberPlans.filter((plan) => plan.lifetime)
  async function refreshLicense() {
    if (!isWailsReady()) return
    license = await safe<LicenseStatus>(() => WGetLicenseStatus(), license)
  }
  async function loadCommerce() {
    if (!isWailsReady() || !license.enabled) return
    commerceLoading = true
    planLoadError = ''
    try {
      const plansResult = await WGetMembershipPlans() as any
      if (plansResult?.err) {
        memberPlans = []
        planLoadError = `套餐读取失败：${plansResult.err}`
      } else if (Array.isArray(plansResult?.items)) {
        memberPlans = plansResult.items
      } else {
        memberPlans = []
        planLoadError = '后台暂未返回可购买套餐，请刷新后重试。'
      }
      const announcementResult = await WGetAnnouncements() as any
      if (!announcementResult?.err) announcements = Array.isArray(announcementResult?.items) ? announcementResult.items : []
      if (!license.signedIn) { accountDevices = []; memberOrders = []; deviceLoadError = ''; return }
      const [deviceResult, orderResult] = await Promise.all([WGetMyDevices(), WGetMyOrders()]) as any[]
      if (deviceResult?.err) {
        accountDevices = []
        deviceLoadError = '设备读取失败，当前登录会话可能已失效。请退出账号后重新登录，设备数据会从服务端恢复。'
        await refreshLicense()
      } else {
        deviceLoadError = ''
        accountDevices = Array.isArray(deviceResult?.items) ? deviceResult.items : []
      }
      if (!orderResult?.err) {
        memberOrders = Array.isArray(orderResult?.items) ? orderResult.items : []
        // A payment may finish after the user closes the payment sheet or the
        // whole app. Recover the lease once from the newest paid order instead
        // of requiring the in-memory activeOrder poll to still exist.
        const paid = memberOrders.find(o => o.status === 'paid')
        if (paid && license.signedIn && !license.authenticated && paid.orderNo !== entitlementRecoveryOrder) {
          entitlementRecoveryOrder = paid.orderNo
          const refreshErr = await WRefreshEntitlement()
          if (!refreshErr) await refreshLicense()
          else {
            entitlementRecoveryOrder = ''
            commerceError = refreshErr
          }
        }
      }
    } catch (e) {
      memberPlans = []
      planLoadError = '套餐读取失败，请检查网络后刷新。'
      console.warn('[ProxySplit] commerce load failed', e)
    } finally {
      commerceLoading = false
    }
  }
  async function openMembership() {
    showMembership = true
    await loadCommerce()
  }
  async function submitLogin() {
    if (!loginForm.username.trim() || !loginForm.password) { loginError = '请输入用户名和密码'; return }
    loginBusy = true; loginError = ''
    const err = await WLogin(loginForm.username.trim(), loginForm.password)
    loginBusy = false
    if (err) { loginError = err; return }
    loginForm.password = ''
    await refreshLicense()
    await loadCommerce()
    if (!license.authenticated || license.planCode === 'trial') { showMembership = true; membershipPrompted = true }
  }
  async function submitRegister() {
    const username = loginForm.username.trim()
    const email = loginForm.email.trim()
    if (username.length < 3 || /[\s@]/.test(username)) { loginError = '用户名至少 3 位，不能包含空格或 @'; return }
    if (!/^\S+@\S+\.\S+$/.test(email) || loginForm.password.length < 8) { loginError = '请填写有效邮箱，密码至少 8 位'; return }
    loginBusy = true; loginError = ''
    const err = await WRegister(username, email, loginForm.password)
    loginBusy = false
    if (err) { loginError = err; return }
    loginForm.password = ''
    await refreshLicense()
    await loadCommerce()
    // 注册后直接展示试用说明和实时套餐，用户不必再去找续费入口。
    showMembership = true; membershipPrompted = true
  }
  async function buyPlan(plan: MemberPlan) {
    commerceBusy = true; commerceError = ''
    try {
      const result = await WCreateMembershipOrder(plan.id) as any
      if (result?.err) { commerceError = result.err; return }
      if (result?.split && Array.isArray(result.orders) && result.orders.length > 1) {
        splitOrders = result.orders; splitIdx = 0
        await showPayment(splitOrders[0])
      } else {
        splitOrders = []; splitIdx = 0
        await showPayment(result.order)
      }
      await loadCommerce()
    } catch (e) {
      activeOrder = null; paymentQR = ''
      commerceError = e instanceof Error ? e.message : '创建订单失败，请重试'
    } finally { commerceBusy = false }
  }
  async function showPayment(order: MemberOrder) {
    activeOrder = order
    paymentQR = ''
    if (!order?.payUrl) { commerceError = '支付服务未返回支付宝付款链接，请重新创建订单'; return }
    const qr = await WGetPaymentQR(order.payUrl) as any
    if (qr?.err || !qr?.data) { commerceError = qr?.err || '支付宝二维码生成失败'; return }
    paymentQR = qr.data
    startPaymentPolling()
  }
  // 展示二维码后自动轮询到账（与统一收款 5ff 一致：3s 一次，后台标签页暂停，回前台立即查一次，
  // 到账/过期即停）。服务端 GET /v1/me/orders 会顺带向网关查单落地，无需依赖异步回调。
  async function pollActiveOrderOnce() {
    if (!activeOrder || !isWailsReady() || paymentPollBusy) return
    paymentPollBusy = true
    try {
      const res = await WGetMyOrders() as any
      if (res?.err) return
      if (Array.isArray(res?.items)) memberOrders = res.items
      const order = memberOrders.find(o => o.orderNo === activeOrder?.orderNo)
      if (!order) return
      if (order.status === 'paid') {
        // 拆单：本笔到账后自动切到下一笔的二维码；最后一笔付完才发货。
        if (splitOrders.length > 1 && splitIdx < splitOrders.length - 1) {
          splitIdx += 1
          await showPayment(splitOrders[splitIdx])
          return
        }
        stopPaymentPolling()
        const err = await WRefreshEntitlement()
        if (err) commerceError = err
        else { activeOrder = null; paymentQR = ''; splitOrders = []; splitIdx = 0; showMembership = false; await refreshLicense() }
      } else if (order.status === 'failed' || order.status === 'expired' || order.status === 'cancelled') {
        stopPaymentPolling()
        commerceError = '订单已过期或取消，请重新下单'
        activeOrder = null; paymentQR = ''; splitOrders = []; splitIdx = 0
      }
    } catch (e) {
      console.warn('[ProxySplit] payment poll failed', e)
    } finally { paymentPollBusy = false }
  }
  function startPaymentPolling() {
    stopPaymentPolling()
    paymentPoll = setInterval(() => { if (typeof document !== 'undefined' && document.hidden) return; pollActiveOrderOnce() }, 3000)
    paymentPollVis = () => { if (!document.hidden) pollActiveOrderOnce() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', paymentPollVis)
  }
  function stopPaymentPolling() {
    if (paymentPoll) { clearInterval(paymentPoll); paymentPoll = null }
    if (paymentPollVis && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', paymentPollVis); paymentPollVis = null }
  }
  // 已有有效权益时，关闭会员弹窗才停止轮询。无有效权益用户使用的是整页购买
  // 界面（showMembership=false），不能因此误停付款查单。
  $: if (license.authenticated && !showMembership && paymentPoll) stopPaymentPolling()
  // 关闭付款浮层：停止轮询并清空当前订单（订单本身仍在服务端，到期自动失效）。
  function closePayment() {
    stopPaymentPolling()
    activeOrder = null; paymentQR = ''; splitOrders = []; splitIdx = 0
  }
  async function changePassword() {
    if (!pwCurrent || pwNext.length < 8) return
    pwBusy = true; pwMsg = ''; pwErr = false
    const err = await WChangeAccountPassword(pwCurrent, pwNext)
    pwBusy = false
    if (err) { pwMsg = err; pwErr = true; return }
    pwCurrent = ''; pwNext = ''
    pwMsg = '密码已修改，其它设备需重新登录'
    toast('密码修改成功')
  }
  async function redeem() {
    const code = redeemInput.trim()
    if (!code) { commerceError = '请输入兑换码'; return }
    redeemBusy = true; commerceError = ''
    const err = await WRedeemCode(code)
    redeemBusy = false
    if (err) { commerceError = err; return }
    redeemInput = ''
    await refreshLicense(); await loadCommerce()
    showRedeemDialog = false
    toast('兑换成功，会员权益已开通')
  }
  // 侧边栏常驻入口：未登录先引导登录/开通，已登录直接弹出兑换框。
  function openRedeem() {
    commerceError = ''
    if (!license.authenticated) { openMembership(); return }
    showRedeemDialog = true
  }
  async function refreshPayment() {
    commerceBusy = true; commerceError = ''
    try {
      await loadCommerce()
      const order = activeOrder && memberOrders.find(o => o.orderNo === activeOrder?.orderNo)
      if (order?.status === 'paid') {
        if (splitOrders.length > 1 && splitIdx < splitOrders.length - 1) {
          splitIdx += 1
          await showPayment(splitOrders[splitIdx])
        } else {
          const err = await WRefreshEntitlement()
          if (err) commerceError = err
          else { activeOrder = null; paymentQR = ''; splitOrders = []; splitIdx = 0; showMembership = false; await refreshLicense() }
        }
      } else commerceError = splitOrders.length > 1 ? `第 ${splitIdx + 1} 笔暂未查询到支付成功，请完成本笔支付后重试` : '暂未查询到支付成功，请完成支付后重试'
    } catch (e) {
      commerceError = e instanceof Error ? e.message : '刷新到账失败，请重试'
    } finally { commerceBusy = false }
  }
  async function unbindDevice(id: string) {
    if (!confirm('确认解绑这台设备并立即撤销会话？')) return
    const err = await WUnbindMyDevice(id)
    if (err) { commerceError = err; return }
    if (license.deviceLimitReached) {
      commerceBusy = true
      const activateErr = await WActivateCurrentDevice()
      commerceBusy = false
      if (activateErr) { commerceError = '旧设备已解绑，但本机激活失败：' + activateErr; await loadCommerce(); return }
      commerceError = ''
      toast('旧设备已解绑，本机已自动激活，可以启动代理')
    }
    await refreshLicense(); await loadCommerce()
  }
  async function logoutAccount() {
    if (!confirm('退出当前账号后代理会停止，是否继续？')) return
    const err = await WLogout()
    if (err) { toast('退出失败：' + err); return }
    activeOrder = null; paymentQR = ''; showMembership = false
    await refreshLicense(); await refreshStatus(); await loadCommerce()
  }
  const demoHealth: Health = { running: true, capturing: true, capturedPkts: 12873, warning: '',
    lines: [ { id: 'rule', name: '规则', node: 'JP | Tokyo - 01', latency: 48, ok: true },
             { id: 'global', name: '全局', node: 'JP | Tokyo - 01', latency: 48, ok: true },
             { id: 'us', name: '美区-全局', node: 'US | Los Angeles - 02', latency: 126, ok: true } ] }
  async function refreshHealth() { health = await safe<Health>(() => WGetHealth() as Promise<Health>, demoHealth) }
  const demoConns: Conn[] = [
    { process: 'Code.exe', host: 'api.githubcopilot.com', dest: '140.82.113.22:443', network: 'tcp', rule: 'process_name Code.exe', outbound: 'JP | Tokyo - 01', outTag: 'proxy', upload: 20480, download: 512000 },
    { process: 'chrome.exe', host: 'www.baidu.com', dest: '110.242.68.66:443', network: 'tcp', rule: 'rule_set geosite-cn', outbound: '直连', outTag: 'direct', upload: 8192, download: 102400 },
    { process: 'msedge.exe', host: 'doubleclick.net', dest: '—', network: 'tcp', rule: 'rule_set geosite-ads', outbound: '拦截', outTag: 'reject', upload: 0, download: 0 },
  ]
  async function refreshConns() {
    if (useDemo) { conns = demoConns; return }
    if (!isWailsReady()) return
    conns = await safe<Conn[]>(() => WGetConnections() as Promise<Conn[]>, [])
  }
  function fmtBytes(n: number): string {
    if (!(n > 0)) return '0'
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'M'
    if (n >= 1024) return (n / 1024).toFixed(0) + 'K'
    return n + 'B'
  }
  // 出口着色：拦截=红、直连=灰、走节点=品牌色
  function outClass(c: Conn): string {
    if (c.outTag === 'reject' || c.outTag === 'block') return 'block'
    if (c.outTag === 'direct') return 'direct'
    return 'proxy'
  }
  $: filteredConns = conns.filter((c) => !connFilter || `${c.process} ${c.host} ${c.dest} ${c.rule} ${c.outbound}`.toLowerCase().includes(connFilter.toLowerCase()))
  $: if (tab === 'logs') refreshConns() // 进入日志页立即拉一次连接
  async function refreshRules() {
    if (!isWailsReady()) { useDemo = true; rules = demoRules; recent = demoLogs; return }
    // Real backend path: fall back to EMPTY (not demoRules) so a genuinely
    // empty rule set never shows phantom demo apps the user didn't add.
    const list = await safe(() => WGetAppRules() as Promise<AppRule[]>, [] as AppRule[])
    // Per-app action: 规则(rule) / 全局(global) / 直连(direct) / 拦截(block).
    // Normalize any legacy/custom line id to one of these four (default 规则).
    rules = normalizeRules(list)
  }
  async function refreshSubs() { subs = isWailsReady() ? await safe(() => WGetSubs() as Promise<Sub[]>, [] as Sub[]) : demoSubs }
  async function refreshSettings() { settings = await safe(() => WGetSettings() as Promise<Settings>, demoSettings) }
  async function refreshRouting() {
    routing = await safe(() => WGetRouting() as Promise<Routing>, { enabled: true, mode: 'global', rules: [] })
    if (!routing.rules) routing.rules = []
    if (typeof routing.enabled !== 'boolean') routing.enabled = true
  }
  // --- lines (routing targets) + default line (whitelist) ---
  async function refreshLines() { lines = await safe(() => WGetLines() as Promise<Line[]>, demoLines) }
  async function refreshDefaultLine() {
    defaultLine = await safe<string>(() => WGetDefaultLine(), 'rule')
    if (!defaultLine) defaultLine = 'rule'
  }
  async function applyDefaultLine() {
    if (useDemo || !isWailsReady()) return
    const err = await WSetDefaultLine(defaultLine)
    if (err) toast('默认线路保存失败：' + err)
  }

  function lineNodeLabel(node: string): string {
    if (node === 'active') return '跟随活动节点'
    if (node === 'direct') return '直连'
    const n = nodes.find((x) => x.id === node); return n ? n.name : node
  }
  function modeLabel(mode: string): string { return mode === 'bypass_cn' ? '绕过大陆' : mode === 'custom' ? '自定义' : '全局' }

  function newLine() { lineForm = { id: '', name: '', node: 'active', mode: 'global', rules: [] }; showLineForm = true }
  function editLine(l: Line) {
    lineForm = { id: l.id, name: l.name, node: l.node, mode: l.routing.mode, rules: (l.routing.rules || []).map((r) => ({ ...r })) }
    showLineForm = true
  }
  function addLineRule() { lineForm.rules = [...lineForm.rules, { type: 'suffix', value: '', action: 'direct' }] }
  function removeLineRule(i: number) { lineForm.rules = lineForm.rules.filter((_, k) => k !== i) }
  async function saveLine() {
    const name = lineForm.name.trim()
    if (!name) { toast('请填写线路名称'); return }
    const id = lineForm.id || 'line-' + Date.now()
    const entry: Line = { id, name, node: lineForm.node, routing: { mode: lineForm.mode, rules: lineForm.rules.filter((r) => r.value.trim()) }, builtin: false }
    const custom = [...lines.filter((l) => !l.builtin && l.id !== id), entry]
    if (useDemo || !isWailsReady()) { lines = [...lines.filter((l) => l.builtin), ...custom] }
    else {
      const err = await WSetLines(custom as any)
      if (err) { toast('线路保存失败：' + err); return }
      await refreshLines()
    }
    showLineForm = false
  }
  async function deleteLine(l: Line) {
    const custom = lines.filter((x) => !x.builtin && x.id !== l.id)
    if (useDemo || !isWailsReady()) { lines = [...lines.filter((x) => x.builtin), ...custom] }
    else {
      const err = await WSetLines(custom as any)
      if (err) { toast('线路删除失败：' + err); return }
      await refreshLines()
    }
    if (rules.some((r) => r.line === l.id)) { rules = rules.map((r) => (r.line === l.id ? { ...r, line: 'rule' } : r)); await pushRules() }
    if (defaultLine === l.id) { defaultLine = 'rule'; await applyDefaultLine() }
  }

  // New: pull fresh geosite / geoip rule-sets so 分流 stays accurate.
  async function updateRuleSets() {
    if (ruleSetMsg === '更新中…') return
    ruleSetMsg = '更新中…'
    const err = await safe<string>(() => WUpdateRuleSets(), '')
    ruleSetMsg = err ? '失败：' + err : '已更新'
    await refreshRuleSets()
    setTimeout(() => (ruleSetMsg = ''), 3500)
  }
  const demoRuleSets: RuleSet[] = [
    { name: 'geosite-cn.srs', display: '国内网站 (geosite-cn)', desc: '识别大陆网站域名 → 直连不走代理', sizeKB: 52, modified: '2026-07-06', present: true, enabled: true },
    { name: 'geoip-cn.srs', display: '国内 IP (geoip-cn)', desc: '识别大陆 IP 段 → 直连不走代理', sizeKB: 33, modified: '2026-07-06', present: true, enabled: true },
    { name: 'geosite-category-ads-all.srs', display: '广告域名 (ads)', desc: '广告/追踪域名 → 直接拦截', sizeKB: 8, modified: '2026-07-06', present: true, enabled: true },
  ]
  async function refreshRuleSets() { ruleSets = await safe<RuleSet[]>(() => WGetRuleSets() as Promise<RuleSet[]>, demoRuleSets) }
  async function toggleRuleSet(rs: RuleSet) {
    if (useDemo || !isWailsReady()) { rs.enabled = !rs.enabled; ruleSets = [...ruleSets]; return }
    ruleSetMsg = '应用中…'
    const err = await WSetRuleSetEnabled(rs.name, !rs.enabled)
    await refreshRuleSets()
    ruleSetMsg = err ? '失败：' + err : running ? '已保存并重启生效' : '已保存（启动后生效）'
    setTimeout(() => (ruleSetMsg = ''), 3500)
  }
  let customRules: RouteRule[] = []
  let custRuleMsg = ''
  async function refreshCustomRules() { customRules = await safe<RouteRule[]>(() => WGetCustomRules() as Promise<RouteRule[]>, []) }
  function addCustomRule() { customRules = [...customRules, { type: 'suffix', value: '', action: 'proxy' }] }
  function removeCustomRule(i: number) { customRules = customRules.filter((_, k) => k !== i) }
  async function saveCustomRules() {
    if (useDemo || !isWailsReady()) { custRuleMsg = '演示模式无法保存'; setTimeout(() => (custRuleMsg = ''), 2500); return }
    custRuleMsg = '应用中…'
    const err = await WSetCustomRules(customRules.filter((r) => (r.value || '').trim()))
    if (err) { custRuleMsg = '保存失败：' + err; setTimeout(() => (custRuleMsg = ''), 4500); return }
    await refreshCustomRules()
    custRuleMsg = running ? '已保存并重启生效' : '已保存(启动后生效)'
    setTimeout(() => (custRuleMsg = ''), 3500)
  }
  async function resetConfig() {
    if (!confirm('重置为默认配置?\n\n会清空:应用规则、自定义线路、所有开关设置(恢复默认)。\n会保留:你添加的节点和订阅。\n\n确定继续?')) return
    if (useDemo || !isWailsReady()) { toast('演示模式无法重置'); return }
    await WResetConfig()
    await refreshRules(); await refreshLines(); await refreshSettings(); await refreshRouting(); await refreshDefaultLine(); await refreshClashMode()
    const m = await safe<string>(() => WGetRuleMode(), ruleMode); ruleMode = m === 'blacklist' ? 'blacklist' : 'whitelist'
    themePref = settings.theme || 'light'; applyTheme(themePref)
    toast('已重置为默认配置(节点已保留)')
  }

  function toast(t: string) { addMsg = t; setTimeout(() => (addMsg = ''), 3500) }

  // --- AI 控制 API ---
  let aiInfo = { url: 'http://127.0.0.1:18088', token: '', prompt: '', mcpConfig: '', running: false }
  let aiMsg = ''
  let aiTokenShown = false
  async function refreshAIInfo() { aiInfo = await safe(() => WGetAIControlInfo() as Promise<typeof aiInfo>, aiInfo) }
  async function copyText(t: string, label: string) {
    if (!t) { aiMsg = '暂无内容'; setTimeout(() => (aiMsg = ''), 2000); return }
    try { await navigator.clipboard.writeText(t); aiMsg = label + '已复制到剪贴板 ✓' }
    catch { aiMsg = '复制失败，请手动选中复制' }
    setTimeout(() => (aiMsg = ''), 2800)
  }
  $: aiTokenMasked = aiInfo.token ? aiInfo.token.slice(0, 6) + '••••••••' + aiInfo.token.slice(-4) : ''

  async function addNodes() {
    if (!linkText.trim()) return
    const r: any = await safe(() => WAddNodes(linkText), { added: 0, skipped: 0 })
    linkText = ''
    toast(`已添加 ${r.added ?? 0} 个，跳过 ${r.skipped ?? 0} 个`)
    await refreshNodes(); await refreshStatus()
  }

  let showManual = false
  let manualMsg = ''
  let manual = { type: 'socks', name: '', server: '', port: 1080, username: '', password: '' }
  function resetManual() { manual = { type: 'socks', name: '', server: '', port: 1080, username: '', password: '' } }
  async function submitManual() {
    if (!manual.server.trim() || !manual.port) { manualMsg = '请填写地址和端口'; return }
    if (useDemo || !isWailsReady()) { manualMsg = '演示模式，无法添加'; return }
    const err = await WAddManualNode(manual.type, manual.name, manual.server.trim(), Number(manual.port), manual.username, manual.password)
    if (err) { manualMsg = err; return }
    manualMsg = ''; showManual = false; resetManual()
    toast('已添加 1 个节点')
    await refreshNodes(); await refreshStatus()
  }
  async function removeNode(id: string) {
    if (useDemo) { nodes = nodes.filter((n) => n.id !== id); return }
    await WRemoveNode(id); await refreshNodes(); await refreshStatus()
  }
  async function selectNode(id: string) {
    if (useDemo) { const n = nodes.find((x) => x.id === id); status = { ...(status || demoStatus), selectedId: id, nodeName: n?.name || '' }; return }
    await WSelectNode(id); await refreshStatus()
  }
  function onNodeChange(e: Event) { selectNode((e.target as HTMLSelectElement).value) }

  async function addRule(name: string, path = '') {
    const value = name.trim()
    if (!value || rules.some((r) => (r.match || '').toLowerCase() === value.toLowerCase())) return
    rules = [...rules, { match: value, path: path || value, line: 'rule', enabled: true }]
    await pushRules()
  }
  async function removeRule(r: AppRule) { rules = rules.filter((x) => x !== r); await pushRules() }
  async function toggleRule(r: AppRule) { r.enabled = !r.enabled; rules = rules; await pushRules() }
  async function onRuleLineChange() { rules = rules; await pushRules() }
  async function clearRules() { rules = []; await pushRules() }
  async function submitNewApp() { await addRule(newApp); newApp = '' }

  async function applyRuleMode() {
    if (useDemo || !isWailsReady()) return
    const err = await WSetRuleMode(ruleMode)
    if (err) toast('分流模式保存失败：' + err)
  }
  async function setRuleMode(m: 'blacklist' | 'whitelist') {
    if (ruleMode === m) return
    ruleMode = m
    await applyRuleMode()
  }

  // --- 从文件夹选择程序（不必正在运行）---
  async function pickFiles() {
    if (useDemo || !isWailsReady()) { toast('演示模式无法打开文件选择'); return }
    const paths = await WPickExeFiles()
    for (const p of paths || []) {
      const base = p.split(/[\\/]/).pop() || p
      await addRule(base, p)
    }
    if (paths && paths.length) toast(`已添加 ${paths.length} 个程序`)
  }

  // --- 逐应用测连通 / 延迟 ---
  function baseName(s: string): string { return (s || '').split(/[\\/]/).pop() || s }
  async function testApp(r: AppRule) {
    appLat = { ...appLat, [r.match]: -99 } // testing
    if (useDemo || !isWailsReady()) { await new Promise((x) => setTimeout(x, 500)); appLat = { ...appLat, [r.match]: 66 }; return }
    const ms = await WTestApp(r.match)
    appLat = { ...appLat, [r.match]: ms }
  }
  function latText(ms: number | undefined): string {
    if (ms === undefined) return '测试'
    if (ms === -99) return '…'
    if (ms === 0) return '直连'
    if (ms === -2) return '拦截'
    if (ms < 0) return '不通'
    return ms + ' ms'
  }

  // --- 逐应用运行状态（是否正在运行）---
  async function refreshRunning() {
    liveProcs = await safe<Proc[]>(() => WListProcesses() as Promise<Proc[]>, [])
    const set = new Set<string>()
    const wanted = new Set(rules.map((r) => baseName(r.match || r.path).toLowerCase()))
    for (const p of liveProcs) {
      const exe = baseName(p.path || p.name).toLowerCase()
      set.add((p.name || '').toLowerCase())
      if (wanted.has(exe)) loadIcon(p.path)
    }
    runningExes = set
  }
  function isRunning(r: AppRule): boolean { return runningExes.has(baseName(r.match).toLowerCase()) }

  // --- 整体配置备份 导出 / 导入到文件 ---
  async function exportConfig() {
    if (useDemo || !isWailsReady()) { toast('演示模式无法导出'); return }
    const err = await WExportConfig()
    toast(err ? '导出失败: ' + err : '已导出配置备份')
  }
  async function importConfig() {
    if (useDemo || !isWailsReady()) { toast('演示模式无法导入'); return }
    const err = await WImportConfig()
    if (err) { toast('导入失败: ' + err); return }
    await refreshNodes(); await refreshRules(); await refreshLines(); await refreshSettings(); await refreshDefaultLine()
    toast('已导入配置备份')
  }
  async function testAllLatency() {
    if (latencyTesting || useDemo || !isWailsReady()) return
    latencyTesting = true
    nodes = nodes.map((n) => ({ ...n, latency: -99, tcpLatency: -99 }))
    try {
      await WTestAllLatency()
      await refreshNodes()
    } catch (e) {
      toast('Google 连通性检测失败：' + e)
      await refreshNodes()
    } finally {
      latencyTesting = false
    }
  }
  // 测 Google：完整代理链路访问 google 204 的端到端延迟（顺带刷新 TCP 延迟）
  async function testNodeGoogle(n: Node) {
    if (latencyTestingId || useDemo || !isWailsReady()) return
    latencyTestingId = n.id
    nodes = nodes.map((x) => x.id === n.id ? { ...x, latency: -99, tcpLatency: -99 } : x)
    try {
      await WTestLatency(n.id)
      await refreshNodes()
    } catch (e) {
      toast('Google 连通性检测失败：' + e)
      await refreshNodes()
    } finally {
      latencyTestingId = ''
    }
  }
  // 测 TCP：直连到节点边缘的传输层延迟（快，不需要启动核心）
  async function testNodeTCP(n: Node) {
    if (tcpTestingId || useDemo || !isWailsReady()) return
    tcpTestingId = n.id
    nodes = nodes.map((x) => x.id === n.id ? { ...x, tcpLatency: -99 } : x)
    try {
      await WTestTCP(n.id)
      await refreshNodes()
    } catch (e) {
      toast('TCP 连通性检测失败：' + e)
      await refreshNodes()
    } finally {
      tcpTestingId = ''
    }
  }
  // 测速度：经该节点下载测吞吐（MB/s）
  async function testNodeSpeed(n: Node) {
    if (speedTestingId || useDemo || !isWailsReady()) return
    speedTestingId = n.id
    try {
      const res = await WSpeedTestNode(n.id)
      if (res && res.err) toast('测速失败：' + res.err)
      await refreshNodes()
    } catch (e) {
      toast('测速失败：' + e)
      await refreshNodes()
    } finally {
      speedTestingId = ''
    }
  }

  // --- 侧栏底部：官网 / GitHub / QQ群 ---
  async function openWebsite() { if (isWailsReady()) { try { await WOpenWebsite() } catch (e) { toast('打开官网失败：' + e) } } }
  async function openGitHub() { if (isWailsReady()) { try { await WOpenGitHub() } catch (e) { toast('打开 GitHub 失败：' + e) } } }
  async function copyContact(value: string, label: string) {
    try {
      if (isWailsReady()) await WCopyToClipboard(value)
      else await navigator.clipboard?.writeText(value)
      toast(`已复制${label} ${value}`)
    } catch { toast(`${label}：${value}`) }
  }
  const QQ_GROUP = '719243244'
  const SERVICE_WECHAT = 'zyg69996'
  const copyQQ = () => copyContact(QQ_GROUP, 'QQ 群号')
  const copyWechat = () => copyContact(SERVICE_WECHAT, '客服微信')

  // --- 一键切模式 (clash mode: 规则/全局/直连, no restart) ---
  async function refreshClashMode() { clashMode = await safe<string>(() => WGetClashMode(), clashMode) }
  async function setClash(mode: string) {
    if (clashMode === mode) return
    clashMode = mode
    if (useDemo || !isWailsReady()) { pushLog('[ui] 演示：切换模式 ' + mode); return }
    const err = await WSetClashMode(mode)
    if (err) { pushLog('[error] 切换模式失败: ' + err); toast('切换失败: ' + err) }
  }
  function clashLabel(m: string): string { return m === 'global' ? '全局' : m === 'direct' ? '直连' : '规则' }

  // --- 系统代理开关 ---
  async function refreshSysProxy() { sysProxy = await safe<boolean>(() => WGetSystemProxy(), sysProxy) }


  // --- 下载测速 (active node) ---
  async function runSpeedTest() {
    if (speedTesting) return
    speedTesting = true; speedMsg = '测速中…'
    try {
      if (useDemo || !isWailsReady()) { await new Promise((r) => setTimeout(r, 800)); speedMsg = '演示: 11.20 MB/s'; return }
      const res = await WSpeedTest()
      if (res && res.err) { speedMsg = '失败: ' + res.err }
      else { speedMsg = (res?.mbps ?? 0).toFixed(2) + ' MB/s'; await refreshNodes() }
    } catch (e) { speedMsg = '失败: ' + e } finally { speedTesting = false }
  }

  // --- QR 分享 ---
  async function showQR(n: Node) {
    qrName = n.name
    if (useDemo || !isWailsReady()) { qrData = ''; toast('演示模式无法生成二维码'); return }
    const res = await WGetNodeQR(n.id)
    if (res && res.err) { toast(res.err); qrName = '' }
    else qrData = res?.data || ''
  }
  function closeQR() { qrData = ''; qrName = '' }
  function closeQRBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) closeQR()
  }

  // --- 赞赏码弹窗 ---
  function openDonate() {
    showDonate = true
    donateLeft = 3
    if (donateTimer) clearInterval(donateTimer)
    donateTimer = setInterval(() => {
      donateLeft = Math.max(0, donateLeft - 1)
      if (donateLeft === 0 && donateTimer) { clearInterval(donateTimer); donateTimer = null }
    }, 1000)
  }
  function closeDonate() {
    if (donateLeft > 0) return // 倒计时未结束，强制停留，忽略关闭
    showDonate = false
  }

  // --- 运行模式 (捕获方式: 应用分流 vs 全局 TUN) ---
  async function setCaptureMode(tun: boolean) {
    if (settings.tunMode === tun || switchingMode) return
    settings.tunMode = tun
    if (useDemo || !isWailsReady()) { settings = settings; return }
    switchingMode = true
    try { await WSetSettings(settings as any); await refreshStatus() } finally { switchingMode = false }
  }

  // --- 开机自启 (真实注册表) ---
  async function refreshAutostart() { autostart = await safe<boolean>(() => WGetAutostart(), autostart) }
  async function toggleAutostart() {
    const want = !autostart
    if (useDemo || !isWailsReady()) { autostart = want; return }
    const err = await WSetAutostart(want)
    if (err) toast(err)
    await refreshAutostart()
  }

  // --- 日志级别 ---
  async function refreshLogLevel() { logLevel = await safe<string>(() => WGetLogLevel(), logLevel) }
  async function changeLogLevel(e: Event) {
    logLevel = (e.target as HTMLSelectElement).value
    if (useDemo || !isWailsReady()) return
    await WSetLogLevel(logLevel)
  }

  // --- 规则导入 / 导出 ---
  async function exportRules() {
    if (useDemo || !isWailsReady()) { rulesMsg = '演示模式无法导出'; return }
    const json = await WExportAppRules()
    try { await navigator.clipboard.writeText(json); rulesMsg = '已复制到剪贴板' }
    catch { rulesMsg = '复制失败，请手动选择' }
    setTimeout(() => (rulesMsg = ''), 3500)
  }
  async function importRules() {
    let text = ''
    try { text = await navigator.clipboard.readText() } catch { text = '' }
    if (!text) { text = prompt('粘贴规则 JSON：') || '' }
    if (!text.trim()) return
    if (useDemo || !isWailsReady()) { rulesMsg = '演示模式无法导入'; return }
    const preview = await WPreviewAppRulesImport(text) as RuleImportPreview
    if (preview.error) { rulesMsg = '预检失败: ' + preview.error; setTimeout(() => (rulesMsg = ''), 4500); return }
    if (!confirm(`规则导入预检通过\n\n${preview.summary}\n\n导入会原子替换对应规则，是否继续？`)) return
    const err = await WImportAppRules(text)
    if (err) { rulesMsg = '导入失败: ' + err }
    else {
      rulesMsg = '导入成功'
      await refreshRules(); await refreshLines(); await refreshCustomRules(); await refreshRuleSets(); await refreshDefaultLine()
      const mode = await WGetRuleMode(); ruleMode = mode === 'blacklist' ? 'blacklist' : 'whitelist'
    }
    setTimeout(() => (rulesMsg = ''), 3500)
  }

  // --- 主题 (亮 / 暗 / 跟随系统) ---
  function applyTheme(p: string) {
    const dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }
  async function setTheme(p: string) {
    themePref = p
    applyTheme(p)
    settings.theme = p
    if (!useDemo && isWailsReady()) await WSetSettings(settings as any)
  }

  // --- real-time status / line detection (reactive so it tracks `health`) ---
  $: capB = !health.running ? { t: '未运行', c: 'idle' }
    : health.warning ? { t: '分流异常', c: 'bad' }
    : health.capturing ? { t: '分流运行中', c: 'ok' }
    : { t: '等待流量…', c: 'wait' }
  // --- overview derived state (reactive so it updates when nodes/status/mode change) ---
  $: activeNodeObj = nodes.find((n) => n.id === status?.selectedId)
  async function submitSub() {
    const n = subName.trim(), u = subUrl.trim()
    if (!n || !u) return
    if (useDemo || !isWailsReady()) {
      subs = [...subs, { id: 'demo-' + Date.now(), name: n, url: u, autoUpdate: subAuto, lastUpdate: '刚刚', nodeCount: 0 }]
      subName = ''; subUrl = ''; subAuto = false; showSubForm = false; toast('订阅已添加'); return
    }
    const err = await WAddSub(n, u, subAuto)
    if (err) { toast('添加失败：' + err); return }
    subName = ''; subUrl = ''; subAuto = false; showSubForm = false
    toast('订阅已添加')
    await refreshSubs(); await refreshNodes()
  }
  function clearSubMsg(id: string) { const m = { ...subMsg }; delete m[id]; subMsg = m }
  function startEditSub(s: Sub) {
    editingSubId = s.id
    editSubName = s.name
    editSubUrl = s.url
    clearSubMsg(s.id)
  }
  function cancelEditSub() {
    editingSubId = ''
    editSubName = ''
    editSubUrl = ''
  }
  async function saveSubEdit(s: Sub) {
    const name = editSubName.trim(), url = editSubUrl.trim()
    if (!name || !url || subMsg[s.id] === '保存中…') return
    subMsg = { ...subMsg, [s.id]: '保存中…' }
    if (useDemo || !isWailsReady()) {
      subs = subs.map((x) => x.id === s.id ? { ...x, name, url } : x)
      cancelEditSub()
      clearSubMsg(s.id)
      return
    }
    const err = await WEditSub(s.id, name, url)
    if (err) {
      subMsg = { ...subMsg, [s.id]: '保存失败：' + err }
      return
    }
    cancelEditSub()
    subMsg = { ...subMsg, [s.id]: '已保存' }
    await refreshSubs(); await refreshNodes()
    setTimeout(() => clearSubMsg(s.id), 3000)
  }
  async function updateSub(id: string) {
    if (subMsg[id] === '更新中…') return
    subMsg = { ...subMsg, [id]: '更新中…' }
    if (useDemo || !isWailsReady()) {
      subMsg = { ...subMsg, [id]: '已更新' }
      setTimeout(() => clearSubMsg(id), 3000)
      return
    }
    const err = await WUpdateSub(id)
    subMsg = { ...subMsg, [id]: err ? '失败' : '已更新' }
    await refreshSubs(); await refreshNodes()
    setTimeout(() => clearSubMsg(id), 3000)
  }
  async function toggleSubAuto(s: Sub) {
    const on = !s.autoUpdate
    s.autoUpdate = on; subs = subs
    if (useDemo || !isWailsReady()) return
    try { await WSetSubAutoUpdate(s.id, on) } catch {}
  }
  async function removeSub(id: string) {
    if (useDemo || !isWailsReady()) { subs = subs.filter((s) => s.id !== id); clearSubMsg(id); return }
    await WRemoveSub(id); clearSubMsg(id); await refreshSubs()
  }
  async function refreshCoreVersion() {
    coreVersion = await safe<string>(() => WGetCoreVersion(), '') || '未知'
  }
  async function updateCore() {
    if (coreMsg === '检查中…') return
    coreMsg = '检查中…'
    try {
      const res = await WUpdateCore()
      if (!res || res.indexOf('ERR:') === 0) { coreMsg = '失败：' + (res ? res.slice(4) : '内核更新未返回版本') }
      else { coreVersion = res; coreMsg = '已更新到 v' + coreVersion + '（重启生效）' }
    } catch (err) {
      coreMsg = '失败：' + String(err)
    }
    setTimeout(() => (coreMsg = ''), 4500)
  }

  async function checkAppUpdate(silent = false) {
    if (useDemo || !isWailsReady()) {
      if (!silent) toast('演示模式不连接更新服务')
      return
    }
    appUpdateBusy = true
    try {
      appUpdate = await WCheckAppUpdate() as AppUpdateStatus
      if (!silent) {
        if (appUpdate.error) toast(appUpdate.error)
        else if (appUpdate.available && appUpdate.release) toast(`发现新版本 v${appUpdate.release.version}`)
        else if (!appUpdate.enabled) toast('当前构建未启用正式更新服务')
        else toast(`当前 v${appUpdate.current} 已是最新版本`)
      }
    } catch (e) {
      if (!silent) toast('检查更新失败：' + String(e))
    } finally {
      appUpdateBusy = false
    }
  }

  async function installAppUpdate() {
    if (!appUpdate.release || appUpdateBusy || !isWailsReady()) return
    appUpdateBusy = true
    const version = appUpdate.release.version
    try {
      const err = await WInstallAppUpdate(appUpdate.release as any)
      if (err) {
        toast('升级失败：' + err)
        appUpdateBusy = false
        return
      }
      toast(`v${version} 已验证，软件即将自动重启完成升级`)
    } catch (e) {
      toast('升级失败：' + String(e))
      appUpdateBusy = false
    }
  }

  function receiveAppUpdate(value: AppUpdateStatus) {
    if (value) appUpdate = value
  }
  async function saveSettings() {
    if (useDemo || !isWailsReady()) return
    await WSetSettings(settings as any)
  }

  async function openPicker() {
    showPicker = true
    procs = await safe(() => WListProcesses() as Promise<Proc[]>, [
      { name: 'Code.exe', path: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', count: 6 },
      { name: 'chrome.exe', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', count: 9 },
      { name: 'node.exe', path: 'D:\\nodejs\\node.exe', count: 12 },
      { name: 'Discord.exe', path: 'C:\\Users\\me\\AppData\\Local\\Discord\\app\\Discord.exe', count: 4 },
    ])
  }

  async function toggleRun() {
    busy = true
    try {
      if (useDemo || !isWailsReady()) {
        const now = !running
        status = { ...(status || demoStatus), coreRunning: now, engineRunning: now }
        pushLog(now ? '[ui] 演示：服务已启动' : '[ui] 演示：服务已停止')
        return
      }
      if (running) await WStop()
      else {
        const err = await WStart()
        if (err) {
          pushLog('[error] ' + err)
          const adminish = /admin|管理员|tun|wintun/i.test(err)
          toast(adminish ? '启动失败：请关闭后「右键 → 以管理员身份运行」' : '启动失败：' + err)
        }
      }
      await refreshStatus()
    } finally { busy = false }
  }

  async function restartCore() {
    if (busy) return
    busy = true
    try {
      if (useDemo || !isWailsReady()) { toast('演示：已重启'); return }
      const err = await WRestart()
      if (err) { pushLog('[error] ' + err); toast('重启失败：' + err) }
      else toast('已重启')
      await refreshStatus()
    } finally { busy = false }
  }

  function pushLog(raw: string) {
    // sing-box colorizes stdout with ANSI escapes; strip them so the log reads
    // as clean text instead of raw ANSI color codes.
    const line = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    logs = [...logs.slice(-800), line]
    const m = line.match(/\[(divert|core|engine|service|rule|ui|error)\]\s*(.*)/)
    const now = new Date()
    const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':')
    const level: LogItem['level'] = /error|fail|失败/i.test(line) ? 'ERROR' : /warn|超时/i.test(line) ? 'WARN' : 'INFO'
    recent = [{ time: t, level, msg: m ? m[2] || line : line }, ...recent].slice(0, 8)
  }

  // Pull one consistent persisted-data snapshot without going through safe().
  // safe() deliberately returns UI fallbacks on transport errors; that is handy
  // for browser preview, but at app startup it used to turn a brief Wails RPC
  // race into apparently "lost" nodes/rules.  Only replace the screen after all
  // decisive calls succeeded, and keep retrying in the background otherwise.
  async function reloadData(): Promise<boolean> {
    if (!isWailsReady() || dataReloading) return false
    dataReloading = true
    try {
      // Nodes + application rules are the irreplaceable user data.  Do not make
      // them wait on any secondary settings/status call that might fail.
      const [newNodes, newRules] = await Promise.all([
        WGetNodes() as Promise<Node[]>,
        WGetAppRules() as Promise<AppRule[]>,
      ])
      nodes = newNodes ?? []
      rules = normalizeRules(newRules)
      useDemo = false

      // Secondary state is best-effort and retains what is already on screen on
      // a transient RPC error; it can never blank the nodes/rules loaded above.
      const [newLines, newSubs, newSettings, newDefaultLine, newStatus, newRuleMode] = await Promise.all([
        safe(() => WGetLines() as Promise<Line[]>, lines),
        safe(() => WGetSubs() as Promise<Sub[]>, subs),
        safe(() => WGetSettings() as Promise<Settings>, settings),
        safe<string>(() => WGetDefaultLine(), defaultLine),
        safe<Status | null>(() => WGetStatus() as Promise<Status>, status),
        safe<string>(() => WGetRuleMode(), ruleMode),
      ])
      lines = newLines ?? []
      subs = newSubs ?? []
      if (newSettings) settings = newSettings
      defaultLine = newDefaultLine || 'rule'
      status = newStatus
      ruleMode = newRuleMode === 'blacklist' ? 'blacklist' : 'whitelist'
      return true
    } catch (e) {
      console.warn('[ProxySplit] persisted data reload failed; will retry', e)
      return false
    } finally {
      dataReloading = false
    }
  }
  // 切回前台时顺带刷新授权：后台刚改过密码/发过会员时，用户看到的立刻是最新状态。
  const onVisible = () => { if (document.visibilityState === 'visible') { reloadData(); refreshLicense() } }

  onMount(async () => {
    // Register before the first await. If Go already ran OnDomReady, consume the
    // retained global; otherwise the event below will deliver the same snapshot.
    window.addEventListener('proxysplit:bootstrap', onBootstrap)
    applyBootstrap((window as any).__PROXYSPLIT_BOOTSTRAP__ as BootstrapState | undefined)

    // Wait for the binding, then let GetBootstrapState wait for service.New and
    // config loading. Do not call GetNodes/GetAppRules during this startup gap.
    let loaded = bootstrapLoaded
    for (let i = 0; i < 120 && !loaded; i++) {
      loaded = await loadBootstrap()
      if (!loaded) await new Promise((r) => setTimeout(r, 100))
    }
    if (isWailsReady()) {
      EventsOn('log', (line: string) => pushLog(line))
      EventsOn('app-update', receiveAppUpdate)
      EventsOn('license-expired', async (message: string) => {
        toast('会员授权已停止：' + message)
        await refreshLicense(); await refreshStatus(); await loadCommerce()
      })
      // 服务端状态变化（后台改密/发放会员/暂停账号等）由看门狗每分钟推送，
      // 界面直接跟着刷新，用户不需要手动点「刷新授权」。
      EventsOn('license-changed', async () => {
        const before = license.plan
        await refreshLicense(); await loadCommerce()
        if (license.plan && license.plan !== before) toast('会员权益已更新：' + license.plan)
      })
    }
    if (!loaded && !bootstrapLoaded) useDemo = true
    // Do not rely only on Svelte's earlier reactive pass: it can occur while
    // Wails is still attaching. At this point rules/processes are real and the
    // bridge is ready, so fetch original executable icons explicitly.
    queueOriginalIcons()
    await refreshRouting()
    await refreshCoreVersion(); await refreshClashMode(); await refreshSysProxy()
    appUpdate.current = await safe<string>(() => WGetAppVersion(), 'dev')
    if (settings.autoUpdateApp) await checkAppUpdate(true)
    await refreshAutostart(); await refreshLogLevel()
    lanIP = await safe<string>(() => WGetLanIP(), '192.168.1.100')
    await refreshRunning(); await refreshHealth(); await refreshRuleSets(); await refreshAIInfo()
    await loadCommerce()
    // 已登录的试用用户首次打开客户端，直接看到试用与购买选择；套餐每分钟重新从后台读取。
    if (!membershipPrompted && license.signedIn && (!license.authenticated || license.planCode === 'trial')) {
      showMembership = true; membershipPrompted = true
    }
    commerceTimer = setInterval(() => { if (license.enabled) loadCommerce() }, 60_000)
    // 自动更新默认在启动时检查；此处补上运行期间 6 小时一次的静默检查。
    appUpdateTimer = setInterval(() => { if (settings.autoUpdateApp) checkAppUpdate(true) }, 6 * 60 * 60 * 1000)
    themePref = settings.theme || 'light'; applyTheme(themePref)
    if (useDemo && recent.length === 0) recent = demoLogs
    window.addEventListener('focus', reloadData)
    document.addEventListener('visibilitychange', onVisible)
    // If the initial 12-second window was still too early, keep trying until the
    // first successful snapshot, then stop so normal in-page edits are never
    // overwritten by a polling refresh.
    if (!loaded) {
      dataRetryTimer = setInterval(async () => {
        if (await loadBootstrap()) {
          if (dataRetryTimer) clearInterval(dataRetryTimer)
          dataRetryTimer = null
        }
      }, 2000)
    }
    timer = setInterval(() => { refreshStatus(); refreshHealth(); if (tab === 'logs') refreshConns() }, 1000)
    if (!license.enabled || license.authenticated) openDonate()
  })
  onDestroy(() => {
    if (timer) clearInterval(timer)
    if (dataRetryTimer) clearInterval(dataRetryTimer)
    if (donateTimer) clearInterval(donateTimer)
    if (commerceTimer) clearInterval(commerceTimer)
    if (appUpdateTimer) clearInterval(appUpdateTimer)
    stopPaymentPolling()
    window.removeEventListener('focus', reloadData)
    window.removeEventListener('proxysplit:bootstrap', onBootstrap)
    document.removeEventListener('visibilitychange', onVisible)
  })

  const I = {
    nodes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><circle cx="7" cy="7.5" r=".6" fill="currentColor"/><circle cx="7" cy="16.5" r=".6" fill="currentColor"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h5l3 6 3-6h5M4 18h5l3-6"/><circle cx="19" cy="6" r="1.6"/><circle cx="19" cy="18" r="1.6"/></svg>',
    subs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5a14 14 0 0 1 14 14M5 12a7 7 0 0 1 7 7"/><circle cx="6" cy="18" r="1.5" fill="currentColor"/></svg>',
    logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 6h14M5 10h14M5 14h9M5 18h9"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 6.2a3.2 3.2 0 0 1 0 6M17 20a5.5 5.5 0 0 0-2-4.3"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v12M7 12l5 5 5-5M5 20h14"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20V8M7 12l5-5 5 5M5 4h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11a8 8 0 1 0-1 5M20 5v6h-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    imp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v10M8 9l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    exp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 13V3M8 7l4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4 2c-.5 1-1.5 1.2-1.5 2.5M12 17h.01"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><circle cx="8" cy="7.5" r=".7" fill="currentColor"/><circle cx="8" cy="16.5" r=".7" fill="currentColor"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v12M8 11l4 4 4-4M5 21h14"/></svg>',
    gh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.300-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7 0-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.4 4.6-4.6 4.9.3.3.6.9.6 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
    qq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 12c0-4.4-3.6-8-8-8s-8 3.6-8 8a8 8 0 0 0 3 6.2c-.3.9-.8 1.7-1 2.3-.2.5.2.8.6.6 1-.4 2.2-1 3-1.5a8 8 0 0 0 4.8 0c.8.5 2 1.1 3 1.5.4.2.8-.1.6-.6-.2-.6-.7-1.4-1-2.3A8 8 0 0 0 20 12z"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M13 6v12" stroke-dasharray="2 2"/></svg>',
    wechat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 4C5.1 4 2 6.6 2 9.8c0 1.8 1 3.4 2.6 4.5L4 16.5l2.3-1.2c.6.2 1.2.3 1.9.4"/><path d="M15 8.5c3.3 0 6 2.3 6 5.1 0 1.6-.9 3-2.3 4l.5 1.9-2-1.1a7.7 7.7 0 0 1-2.2.3c-3.3 0-6-2.3-6-5s2.7-5.2 6-5.2z"/></svg>',
    bars: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="14" width="3.5" height="6" rx="1"/><rect x="8.2" y="10" width="3.5" height="10" rx="1"/><rect x="13.4" y="6" width="3.5" height="14" rx="1"/><rect x="18.6" y="14" width="3.5" height="6" rx="1" opacity=".35"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v8M7.5 7a7 7 0 1 0 9 0"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7M14 21h3"/></svg>',
    gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/><circle cx="12" cy="18" r="1.2" fill="currentColor"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>',
  }
  function latencyText(ms?: number): string {
    if (ms === -99) return '检测中…'
    if (ms === undefined || ms === 0) return '未检测'
    if (ms < 0) return 'Google 不通'
    return `${ms} ms`
  }
  function tcpLatencyText(ms?: number): string {
    if (ms === -99) return '检测中…'
    if (ms === undefined || ms === 0) return '未检测'
    if (ms < 0) return 'TCP 不通'
    return `${ms} ms`
  }
  function nodeOptionLabel(n: Node): string { return `${n.name} · ${latencyText(n.latency)}` }
  function qual(ms?: number) { return !ms || ms < 0 ? 0 : ms < 80 ? 4 : ms < 130 ? 3 : ms < 200 ? 2 : 1 }
</script>

<svelte:head><title>ProxySplit</title></svelte:head>

<!-- 强制升级：mandatory 版本覆盖全屏、不可关闭，且渲染在登录/会员闸机之外，
     未登录或试用到期的用户同样能收到并完成升级（否则更新横幅只在主界面可见）。 -->
{#if appUpdate.available && appUpdate.release && appUpdate.release.mandatory}
  <div class="update-force-mask" role="alertdialog" aria-modal="true">
    <div class="update-force">
      <span class="uf-badge">必须升级</span>
      <h2>请升级到 v{appUpdate.release.version}</h2>
      <p>当前版本 v{appUpdate.current} 已停止支持，需完成升级后才能继续使用。升级包已通过 Ed25519 签名与 SHA256 双重校验，升级后自动重启且不会改动你的节点与规则。</p>
      <button class="primary" on:click={installAppUpdate} disabled={appUpdateBusy || !isWailsReady()}>{appUpdateBusy ? '下载并验证中…' : '立即安全升级'}</button>
    </div>
  </div>
{/if}

{#if license.enabled && !license.authenticated}
  <main class:license-login={!license.signedIn} class:member-gate={license.signedIn}>
    {#if appUpdate.available && appUpdate.release && !appUpdate.release.mandatory}
      <div class="updatebar gate-updatebar">
        <span class="updatebar-icon">↗</span>
        <div><strong>发现新版本 v{appUpdate.release.version}</strong><small>当前 v{appUpdate.current} · 已通过 Ed25519 签名与 SHA256 双重校验</small></div>
        <button on:click={installAppUpdate} disabled={appUpdateBusy || !isWailsReady()}>{appUpdateBusy ? '下载并验证中…' : '立即安全升级'}</button>
      </div>
    {/if}
    {#if !license.signedIn}
      <form class="license-login-card" on:submit|preventDefault={authMode === 'login' ? submitLogin : submitRegister}>
        <div class="license-mark">◑</div>
        <div class="license-login-title">
          <span>ProxySplit</span>
          <small>{authMode === 'login' ? '登录后使用你的授权设备' : '注册后即可登录，符合条件自动获得 3 天试用'}</small>
        </div>
        {#if authMode === 'register'}
          <div class="trial-guide">
            <b>注册即可开始</b>
            <span><i>1</i>填写账号密码</span>
            <span><i>2</i>自动绑定当前电脑</span>
            <span><i>3</i>符合条件领取试用，否则选择套餐</span>
          </div>
        {/if}
        <div class="auth-tabs"><button type="button" class:active={authMode === 'login'} on:click={() => { authMode = 'login'; loginError = '' }}>登录</button><button type="button" class:active={authMode === 'register'} on:click={() => { authMode = 'register'; loginError = '' }}>免费注册</button></div>
        <label>
          <span>用户名</span>
          <input type="text" bind:value={loginForm.username} autocomplete="username" placeholder="请输入用户名" minlength="3" maxlength="32" disabled={loginBusy} />
        </label>
        {#if authMode === 'register'}<label>
          <span>邮箱</span>
          <input type="email" bind:value={loginForm.email} autocomplete="email" placeholder="name@example.com" maxlength="254" disabled={loginBusy} />
        </label>{/if}
        <label>
          <span>密码</span>
          <input type="password" bind:value={loginForm.password} autocomplete={authMode === 'register' ? 'new-password' : 'current-password'} placeholder={authMode === 'register' ? '至少 8 位' : '请输入密码'} minlength="8" disabled={loginBusy} />
        </label>
        {#if loginError}<div class="license-error">{loginError}</div>{/if}
        <button class="primary license-submit" type="submit" disabled={loginBusy || !loginForm.username.trim() || (authMode === 'register' && !loginForm.email.trim()) || !loginForm.password}>
          {loginBusy ? '正在验证…' : authMode === 'login' ? '登录并绑定本机' : '注册并登录'}
        </button>
        <p class="license-tip">{authMode === 'register' ? '邮箱当前不做验证；同一电脑仅能领取一次试用，但始终可以注册新账号并购买套餐。' : '使用用户名和密码登录；设备名额与会员状态由服务端校验。'} 主板等硬件信息只生成摘要，不上传原始序列号。</p>
      </form>
    {:else}
      <section class="member-center">
        <header class="member-hero"><div><span class="member-eyebrow">MEMBERSHIP CENTER</span><h1>{license.deviceLimitReached ? '设备名额已满，请先解绑旧设备' : '选择适合你的会员套餐'}</h1><p>{license.deviceLimitReached ? '本机已安全登录，但尚未激活，代理无法启动。解绑下方任意一台旧设备后，本机会自动激活。' : `你好，${license.username}。当前账号暂无有效会员，完成支付后将在几秒内自动到账。`}</p></div><button class="ghost-btn" on:click={logoutAccount}>退出账号</button></header>
        {#if license.deviceLimitReached}<div class="member-alert"><b>本机待激活</b>：已达到 {license.maxDevices} 台设备上限。请在此页面解绑一台旧设备；解绑成功后系统会自动绑定本机并恢复启动权限。</div>{/if}
        {#if commerceError}<div class="member-alert">{commerceError}</div>{/if}
        <section class="benefit-comparison">
          <div class="benefit-title"><div><b>普通会员与超级会员</b><small>功能与协议完全一致，仅同时在线设备数量不同</small></div></div>
          <div class="benefit-grid">
            <div class="benefit-corner">权益项目</div><div class="benefit-tier">普通会员</div><div class="benefit-tier premium">超级会员</div>
            <div>同时在线设备</div><b>{standardReference?.maxDevices || 3} 台</b><b>{premiumReference?.maxDevices || 8} 台</b>
            <div>代理协议</div><b>全部支持</b><b>全部支持</b>
            <div>应用分流规则</div><b>支持</b><b>支持</b>
            <div>自定义线路</div><b>支持</b><b>支持</b>
            <div>功能权益</div><b>完整功能</b><b>完整功能</b>
          </div>
        </section>
        <div class="plan-sections">
          {#each [
            { key: 'standard', title: '普通会员', note: '适合个人日常使用，支持 3 台设备', plans: standardPlans },
            { key: 'premium', title: '超级会员', note: '功能与普通会员一致，支持 8 台设备', plans: premiumPlans }
          ] as group (group.key)}
            {#if group.plans.length}
              <section class="plan-section">
                <div class="plan-section-title"><div><h3>{group.title}</h3><p>{group.note}</p></div><span>{group.plans.length} 种时长可选</span></div>
                <div class="member-plan-grid compact">
                  {#each group.plans as plan (plan.id)}
                    <article class:premium={plan.tier === 'premium'}>
                      <div class="member-plan-top"><span>{plan.badge || plan.name}</span><em>{plan.maxDevices} 台设备</em></div>
                      <h2>{plan.name}</h2><p>{plan.description || '开通后立即生效，可在有效期内持续使用。'}</p>
                      <strong><small>¥</small>{(plan.priceCents / 100).toFixed(2)}{#if plan.originalPriceCents && plan.originalPriceCents > plan.priceCents}<del>¥{(plan.originalPriceCents / 100).toFixed(2)}</del>{/if}</strong>
                      <div class="plan-highlights"><span>{plan.durationDays || 0} 天</span><span>{plan.maxDevices} 台设备</span><span>{plan.tier === 'premium' ? '全部功能' : '基础功能'}</span></div>
                      <button class="primary" disabled={commerceBusy} on:click={() => buyPlan(plan)}>{commerceBusy ? '请稍候…' : '立即购买'}</button>
                    </article>
                  {/each}
                </div>
              </section>
            {/if}
          {/each}
          {#each lifetimePlans as plan (plan.id)}
            <article class="lifetime-plan">
              <div class="lifetime-copy"><div class="member-plan-top"><span>{plan.badge || '限时活动'}</span><em>{plan.maxDevices} 台设备</em></div><h3>{plan.name}</h3><p>{plan.description || '一次开通，长期使用超级会员全部功能。'}</p><div class="plan-highlights"><span>永久有效</span><span>{plan.maxDevices} 台设备</span><span>超级会员全部功能</span></div></div>
              <div class="lifetime-buy"><strong><small>¥</small>{(plan.priceCents / 100).toFixed(2)}{#if plan.originalPriceCents && plan.originalPriceCents > plan.priceCents}<del>¥{(plan.originalPriceCents / 100).toFixed(2)}</del>{/if}</strong><button class="primary" disabled={commerceBusy} on:click={() => buyPlan(plan)}>{commerceBusy ? '请稍候…' : '立即购买'}</button></div>
            </article>
          {/each}
        </div>
        {#if license.deviceLimitReached}
          <section class="member-panel device-limit-panel"><div class="panel-title"><b>选择要解绑的旧设备</b><span>{accountDevices.length} / {license.maxDevices || '—'} 台</span></div>{#each accountDevices as device}<div class="member-row"><div><b>{device.name}</b><small>{device.appVersion} · 最近在线 {new Date(device.lastSeenAt).toLocaleString()}</small></div><div>{#if device.current}<span class="current-device">当前设备</span>{/if}<button disabled={device.current} title={device.current ? '请勿解绑当前正在使用的设备' : '解绑此旧设备'} on:click={() => unbindDevice(device.id)}>解绑</button></div></div>{:else}<p class="member-empty">暂无可解绑设备</p>{/each}</section>
        {/if}
        {#if announcements.length}<section class="member-panel announcements"><div class="panel-title"><b>公告与更新</b><span>{announcements.length} 条</span></div>{#each announcements.slice(0, 4) as item}<div class="member-row"><div><b>{item.title}</b><small>{item.summary || item.content}</small></div><time>{new Date(item.publishedAt).toLocaleDateString()}</time></div>{/each}</section>{/if}
        {#if activeOrder}<div class="pay-overlay" role="button" tabindex="0" aria-label="关闭付款" on:click|self={closePayment} on:keydown={(e) => e.key === 'Escape' && closePayment()}><div class="pay-modal"><button class="pay-close" title="关闭" on:click={closePayment}>✕</button><div class="payment-sheet qr-payment">{#if paymentQR}<div class="payment-qr-box"><img src={paymentQR} alt="支付宝付款二维码" /><span>请使用支付宝扫码</span></div>{/if}<div class="payment-order-info">{#if splitOrders.length > 1}<span class="split-badge">分 {splitOrders.length} 笔支付 · 第 {splitIdx + 1} 笔</span>{:else}<span>支付宝安全支付</span>{/if}<h3>{activeOrder.planName} · ¥{(activeOrder.amountCents / 100).toFixed(2)}</h3>{#if splitOrders.length > 1}<p class="split-note">⚠️ 本单金额较大，因支付渠道单笔限额，需<b>分 {splitOrders.length} 笔分别支付</b>。请先扫码付本笔 <b>¥{(activeOrder.amountCents / 100).toFixed(2)}</b>，付完会<b>自动跳出下一笔二维码</b>，{splitOrders.length} 笔全部付完才会开通会员，中途请勿关闭。</p>{:else}<p>打开手机支付宝扫描二维码完成付款，支付成功后点击刷新到账状态。</p>{/if}<small>请在 {new Date(activeOrder.expiresAt).toLocaleString()} 前完成支付</small></div><div class="payment-actions"><button class="ghost-btn" on:click={() => activeOrder?.payUrl && WOpenPaymentURL(activeOrder.payUrl)}>本机打开支付宝</button><button class="primary" disabled={commerceBusy} on:click={refreshPayment}>我已支付，刷新状态</button></div></div></div></div>{/if}
      </section>
    {/if}
  </main>
{:else}
<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="logo"><img src={brandIcon} alt="" /></div>
      <div class="brand-title">ProxySplit<small>DESKTOP CLIENT</small></div>
    </div>

    <div class="nav-label">MAIN</div>
    <nav class="side-nav">
      <button class:active={tab === 'overview'} on:click={() => (tab = 'overview')}><i>{@html I.dash}</i><span>概览</span></button>
      <button class:active={tab === 'nodes'} on:click={() => (tab = 'nodes')}><i>{@html I.nodes}</i><span>节点</span>{#if nodes.length}<em class="nav-count">{nodes.length}</em>{/if}</button>
      <button class:active={tab === 'apps'} on:click={() => { tab = 'apps'; refreshRunning() }}><i>{@html I.apps}</i><span>应用分流</span>{#if ruleCount}<em class="nav-count">{ruleCount}</em>{/if}</button>
      <button class:active={tab === 'rules'} on:click={() => { tab = 'rules'; refreshRuleSets(); refreshCustomRules() }}><i>{@html I.shield}</i><span>分流规则</span></button>
      <button class:active={tab === 'subs'} on:click={() => (tab = 'subs')}><i>{@html I.subs}</i><span>订阅</span></button>
      <button class:active={tab === 'logs'} on:click={() => (tab = 'logs')}><i>{@html I.logs}</i><span>日志</span></button>
      <button class:active={tab === 'settings'} on:click={() => (tab = 'settings')}><i>{@html I.settings}</i><span>设置</span></button>
    </nav>

    <div class="sidebar-foot">
      <button class="redeem-entry" title="使用兑换码 / 授权码开通会员" on:click={openRedeem}>
        <i>{@html I.ticket}</i><span>兑换码开通会员</span>
      </button>
      <div class="core-card">
        <span class="dot" class:on={status?.coreRunning}></span>
        <div><strong>{status?.coreRunning ? '核心运行中' : '核心已停止'}</strong><small>sing-box {coreVersion || '1.13.14'}</small></div>
      </div>
      <div class="contact-card">
        <button class="contact-row" title="点击复制 QQ 群号" on:click={copyQQ}>
          <i>{@html I.qq}</i><span>QQ 群 <b>{QQ_GROUP}</b></span><em>点击复制</em>
        </button>
        <button class="contact-row" title="点击复制客服微信" on:click={copyWechat}>
          <i>{@html I.wechat}</i><span>客服微信 <b>{SERVICE_WECHAT}</b></span><em>点击复制</em>
        </button>
      </div>
      <div class="foot-icons">
        <button title="官网 proxysplit.zygskins.cn" on:click={openWebsite}>{@html I.globe}</button>
        <button title="GitHub github.com/xx2468171796" on:click={openGitHub}>{@html I.gh}</button>
      </div>
    </div>
  </aside>

  <section class="workspace">
    <header class="topbar">
      <div class="tb-left">
        <div class="page-identity"><strong>{currentTabMeta.title}</strong><small>{currentTabMeta.desc}</small></div>
        <span class="top-divider"></span>
        <div class="tb-field">
          <span class="tb-label">活动节点 <span class="node-dot" class:on={running}></span></span>
          <select on:change={onNodeChange}>
            {#each nodes as n}<option value={n.id} selected={n.id === status?.selectedId}>{nodeOptionLabel(n)}</option>{/each}
          </select>
        </div>
        <div class="tb-field">
          <span class="tb-label">代理策略</span>
          <div class="mode-seg" title="切换代理策略：规则=智能分流 / 全局=全走代理 / 直连=全不走（不重启）">
            <button class:on={clashMode === 'rule'} on:click={() => setClash('rule')}>规则</button>
            <button class:on={clashMode === 'global'} on:click={() => setClash('global')}>全局</button>
            <button class:on={clashMode === 'direct'} on:click={() => setClash('direct')}>直连</button>
          </div>
        </div>
      </div>

      <div class="tb-right top-metrics">
        {#if license.enabled}
          <button class="account-chip" title={`${membershipIdentity} · ${membershipRemaining}`} on:click={() => (tab = 'settings')}>
            <span>{license.username.slice(0, 1).toUpperCase()}</span>
            <div><b>{license.username}</b><small>{membershipIdentity} · {membershipRemaining}</small></div>
          </button>
        {/if}
        <div class="metric-mini metric-down"><small>下载</small><strong class="down">↓ {dn.v} {dn.u}</strong></div>
        <div class="metric-mini metric-up"><small>上传</small><strong class="up">↑ {up.v} {up.u}</strong></div>
        <div class="metric-mini metric-status"><small>连接 / 状态</small><strong>{activeConns} · {running ? uptime : '未连接'}</strong></div>
        <button class="power-btn" class:running on:click={toggleRun} disabled={busy}>
          {@html running ? I.stop : I.power}<span>{busy ? '…' : running ? '停止' : '启动'}</span>
        </button>
      </div>
    </header>

    {#if appUpdate.available && appUpdate.release}
      <div class="updatebar" class:mandatory={appUpdate.release.mandatory}>
        <span class="updatebar-icon">↗</span>
        <div><strong>{appUpdate.release.mandatory ? '必须升级' : '发现新版本'} v{appUpdate.release.version}</strong><small>当前 v{appUpdate.current} · 已通过 Ed25519 签名与 SHA256 双重校验</small></div>
        <button on:click={installAppUpdate} disabled={appUpdateBusy}>{appUpdateBusy ? '下载并验证中…' : '立即安全升级'}</button>
      </div>
    {/if}

    {#if health.warning && health.warning !== warnDismissed}
      <div class="warnbar">
        <span class="warnbar-ic">⚠</span>
        <div class="warnbar-txt"><strong>分流没生效 —— </strong>{health.warning}</div>
        <button class="warnbar-x" on:click={() => (warnDismissed = health.warning)} title="忽略此提示">✕</button>
      </div>
    {/if}

    <div class="scroll">
      <div class="wrap">
      {#if tab === 'overview'}
        <div class="page-head">
          <div><h1>概览</h1><p>核心状态、分流链路与常用操作集中在一个页面。</p></div>
          <div class="head-actions">{#if running}<button class="btn" on:click={restartCore} disabled={busy}>⟳ 重启核心</button>{/if}<button class="btn" on:click={refreshAll}>刷新状态</button><button class="btn primary" on:click={toggleRun} disabled={busy}>{running ? '停止服务' : '启动服务'}</button></div>
        </div>

        <div class="grid kpis">
          <section class="card kpi"><span class="kpi-icon">{@html I.wifi}</span><div><div class="kpi-label">核心状态</div><div class="kpi-value">{running ? '运行中' : '已停止'}</div></div></section>
          <section class="card kpi"><span class="kpi-icon green">{@html I.server}</span><div><div class="kpi-label">活动节点</div><div class="kpi-value ellipsis">{activeNodeObj?.name || '未选择'} {#if activeNodeObj}<small>{latencyText(activeNodeObj.latency)}</small>{/if}</div></div></section>
          <section class="card kpi"><span class="kpi-icon orange">{@html I.apps}</span><div><div class="kpi-label">应用规则</div><div class="kpi-value">{ruleCount}<small>{proxyCount} 条代理</small></div></div></section>
          <section class="card kpi"><span class="kpi-icon">{@html I.users}</span><div><div class="kpi-label">活动连接</div><div class="kpi-value">{activeConns}<small>{running ? uptime : '未运行'}</small></div></div></section>
        </div>

        <div class="grid main-grid">
          <div class="grid">
            <section class="card">
              <div class="card-head"><div><div class="card-title">分流链路</div><div class="card-sub">从应用到目标节点的实时路径</div></div><span class="status-pill" class:gray={!running}>{capB.t}</span></div>
              <div class="route-flow">
                <div class="flow-step" class:active={running}><span class="flow-node">{@html I.monitor}</span><b>应用程序</b><small>{ruleCount} 条规则</small></div>
                <div class="flow-step" class:active={running}><span class="flow-node">{@html I.shield}</span><b>分流规则</b><small>{ruleMode === 'whitelist' ? '仅列出的' : '默认代理'}</small></div>
                <div class="flow-step" class:active={running}><span class="flow-node">{@html I.box}</span><b>代理核心</b><small>sing-box {coreVersion || '1.13.14'}</small></div>
                <div class="flow-step good" class:active={running}><span class="flow-node">{@html I.server}</span><b>活动节点</b><small>{activeNodeObj?.name || '未选择'}</small></div>
              </div>
            </section>

            <section class="card">
              <div class="card-head"><div><div class="card-title">应用流量</div><div class="card-sub">最近使用与分流状态</div></div><button class="btn sm" on:click={() => (tab = 'apps')}>管理应用</button></div>
              <div class="table-wrap"><table class="table app-traffic-table">
                <colgroup><col class="app-col" /><col class="policy-col" /><col class="node-col-width" /><col class="state-col" /></colgroup>
                <thead><tr><th>应用</th><th>策略</th><th>节点</th><th>状态</th></tr></thead><tbody>
                {#each rules.slice(0, 4) as r}
                  <tr><td><div class="entity">
                    {#if ruleIcon(r)}
                      <span class="entity-icon real-app-icon"><img src={ruleIcon(r)} alt="" /></span>
                    {:else}
                      <span class="entity-icon app-icon-placeholder" title="未能读取该程序的原始图标"></span>
                    {/if}
                    <div class="entity-text"><b>{ruleName(r)}</b><small title={r.path}>{r.path}</small></div>
                  </div></td><td><span class="tag">{r.line === 'direct' ? '直连' : r.line === 'block' ? '拦截' : r.line === 'global' ? '全局' : '规则'}</span></td><td>{r.node ? nodeName(r.node) : '活动节点'}</td><td><span class="status-pill" class:gray={!r.enabled}>{r.enabled ? '已启用' : '已停用'}</span></td></tr>
                {/each}
                {#if rules.length === 0}<tr><td colspan="4"><div class="empty sm">暂无应用规则</div></td></tr>{/if}
              </tbody></table></div>
            </section>
          </div>

          <div class="grid">
            <section class="card"><div class="card-head"><div><div class="card-title">快速操作</div><div class="card-sub">常用功能一步到达</div></div></div><div class="card-body quick-grid">
              <button class="quick" on:click={() => (tab = 'nodes')}><b>＋ 添加节点</b><small>链接导入或手动添加</small></button>
              <button class="quick" on:click={() => { tab = 'apps'; openPicker() }}><b>＋ 添加应用</b><small>选择进程或程序文件</small></button>
              <button class="quick" on:click={testAllLatency} disabled={latencyTesting}><b>⟳ {latencyTesting ? '测速中…' : '全部测速'}</b><small>逐个验证完整代理链路</small></button>
              <button class="quick" on:click={() => (tab = 'logs')}><b>✓ 网络诊断</b><small>检查核心与运行日志</small></button>
            </div></section>
            <section class="card"><div class="card-head"><div><div class="card-title">节点健康</div><div class="card-sub">最近一次检测结果</div></div><button class="btn sm" on:click={() => (tab = 'nodes')}>全部节点</button></div><div class="card-body health-list">
              {#each nodes.slice(0, 4) as n}
                <button class="health-item" on:click={() => selectNode(n.id)}><div class="health-info"><b>{n.name}</b><small>{n.id === status?.selectedId ? '活动节点' : n.type.toUpperCase()}</small><div class="health-bar"><i style={`width:${n.latency && n.latency > 0 ? Math.max(12, 100 - Math.min(n.latency, 500) / 5) : 8}%`}></i></div></div><span class="latency">{latencyText(n.latency)}</span></button>
              {/each}
              {#if nodes.length === 0}<div class="empty sm">还没有节点</div>{/if}
            </div></section>
          </div>
        </div>
      {:else if tab === 'apps'}
        <div class="page-head">
          <div><h1>应用分流</h1><p>规则统计、模式说明和应用列表集中在一个视图内。</p></div>
          <div class="head-actions"><button class="btn" on:click={importRules}>导入</button><button class="btn" on:click={exportRules}>导出</button><button class="btn primary" on:click={openPicker}>＋ 添加应用</button></div>
        </div>
        <div class="summary-strip">
          <div class="summary-cell"><span>分流模式</span><div class="summary-mode"><button class:active={ruleMode === 'whitelist'} on:click={() => setRuleMode('whitelist')}>只代理列出的</button><button class:active={ruleMode === 'blacklist'} on:click={() => setRuleMode('blacklist')}>默认全代理</button></div></div>
          <div class="summary-cell"><span>应用规则</span><b>{ruleCount} 条</b></div>
          <div class="summary-cell"><span>已启用</span><b class="good">{rules.filter((r) => r.enabled).length} 条</b></div>
          <div class="summary-cell"><span>默认出口</span><b>{activeNodeObj?.name || '活动节点'}</b></div>
        </div>
        <div class="cols apps-v2">
          <div class="col-main">
            <section class="card hero">
              <div class="hero-icon">{@html I.apps}</div>
              <div class="hero-text">
                <div class="hero-head"><h2>应用分流</h2><span class="help">{@html I.help} 使用说明</span></div>
                <p>{ruleMode === 'whitelist' ? '仅对列出的应用走代理，没列出的应用直接连接网络。' : '没列出的应用按「规则」智能分流（大陆直连、境外走代理），列出的应用按各自的设置走。'}</p>
                {#if settings.tunMode}
                  <div class="hero-note">当前是「整机全局」模式，下面的应用分流规则不生效。到<button class="linkbtn" on:click={() => (tab = 'settings')}>设置</button>把「代理范围」切回「应用分流」即可启用。</div>
                {:else if clashMode !== 'rule'}
                  <div class="hero-note">流量走向为「{clashMode === 'global' ? '全局' : '直连'}」，已覆盖下面的规则。切回<button class="linkbtn" on:click={() => setClash('rule')}>规则</button>模式让分流生效。</div>
                {/if}
                <div class="flow-label">流量转发路径：</div>
                <div class="flow">
                  <div class="fbox"><i>{@html I.monitor}</i>你的程序</div>
                  <span class="farr">{@html I.chevron}</span>
                  <div class="fbox"><i>{@html I.shield}</i>流量捕获</div>
                  <span class="farr">{@html I.chevron}</span>
                  <div class="fbox"><i>{@html I.box}</i>代理内核</div>
                  <span class="farr">{@html I.chevron}</span>
                  <div class="fbox active"><i>{@html I.server}</i>你的节点</div>
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-head sm">
                <div><h3>分流模式</h3><p class="sub">决定「没在下面列出的应用」怎么走</p></div>
                <div class="mode-seg">
                  <button class:on={ruleMode === 'whitelist'} on:click={() => setRuleMode('whitelist')}>只代理列出的</button>
                  <button class:on={ruleMode === 'blacklist'} on:click={() => setRuleMode('blacklist')}>默认全走代理</button>
                </div>
              </div>
              <div class="mode-explain" class:warn={ruleMode === 'blacklist'}>
                {#if ruleMode === 'whitelist'}
                  <b>只代理列出的</b>：只有下面标为「走代理」的程序走节点，其余程序（含没列出的）一律直连。<span class="mx-tag">日常推荐</span>
                {:else}
                  ⚠️ <b>默认全走代理</b>：没列出的程序也走节点（按「规则」：大陆直连、境外走代理）；列出的程序按各自的「规则 / 全局 / 直连 / 拦截」和节点走。想只让指定程序走代理，请
                  <button class="linkbtn" on:click={() => setRuleMode('whitelist')}>切到「只代理列出的」</button>。
                {/if}
              </div>
            </section>

            <section class="card">
              <div class="card-head">
                <div><h3>应用规则 <small class="autosave">改动即自动保存,关了再开也在</small></h3><p class="sub">共 {ruleCount} 条规则，其中 {proxyCount} 条走代理</p></div>
                <div class="actions">
                  {#if savedMsg}<span class="saved-tag">{savedMsg}</span>{/if}
                  <button class="primary" on:click={openPicker}>{@html I.plus} 添加规则</button>
                  <button class="ghost-btn" on:click={importRules}>{@html I.imp} 导入</button>
                  <button class="ghost-btn" on:click={exportRules}>{@html I.exp} 导出</button>
                  {#if rulesMsg}<span class="rs-msg" class:err={rulesMsg.indexOf('失败') >= 0}>{rulesMsg}</span>{/if}
                </div>
              </div>

              {#if showPicker}
                <div class="picker">
                  <input bind:value={procFilter} placeholder="搜索运行中的进程或路径…" />
                  <div class="proc-list">
                    {#each filteredProcs as p}
                      <div class="proc-row">
                        <div class="app-cell">
                          {#if iconMap[p.path]}
                            <img class="app-icon-img" src={iconMap[p.path]} alt="" />
                          {:else}
                            <span class="app-icon-placeholder" title="未能读取该程序的原始图标"></span>
                          {/if}
                          <div class="proc-info"><strong>{p.desc || p.name}</strong><small>{p.path || p.name}</small></div>
                        </div>
                        <span class="proc-count">{p.count} 进程</span>
                        <button class="mini" disabled={rules.some((r) => (r.match || '').toLowerCase() === (p.path || p.name).toLowerCase())} on:click={() => addRule(p.path || p.name, p.path)}>
                          {rules.some((r) => (r.match || '').toLowerCase() === (p.path || p.name).toLowerCase()) ? '已添加' : '添加'}
                        </button>
                      </div>
                    {/each}
                    {#if filteredProcs.length === 0}<div class="empty sm">没有匹配的进程。试试换个关键字，或在下方手动输入。</div>{/if}
                  </div>
                  <div class="picker-foot">
                    <button class="mini pick" on:click={pickFiles}>{@html I.box} 从文件夹选择…</button>
                    <input class="grow" bind:value={newApp} placeholder="或手动输入 exe 名 / 完整路径" on:keydown={(e) => e.key === 'Enter' && submitNewApp()} />
                    <button class="mini" on:click={submitNewApp}>添加</button>
                    <button class="mini" on:click={() => (showPicker = false)}>收起</button>
                  </div>
                  <p class="pick-hint">「从文件夹选择」可以添加没在运行的程序 —— 浏览到它的 .exe 即可。</p>
                </div>
              {/if}

              <div class="tscroll">
                <div class="rtable">
                  <div class="rhead"><span>应用程序</span><span>分流方式</span><span>节点</span><span class="ctr">启用</span><span class="ctr">操作</span></div>
                  {#each rules as r, i}
                    <div class="rrow" class:off={!r.enabled}>
                      <div class="app-cell">
                        {#if ruleIcon(r)}
                          <img class="app-icon-img" src={ruleIcon(r)} alt="" />
                        {:else}
                          <span class="app-icon-placeholder" title="未能读取该程序的原始图标"></span>
                        {/if}
                        <div class="app-meta"><strong>{ruleName(r)} <span class="run-dot" class:on={isRunning(r)} title={isRunning(r) ? '正在运行' : '未运行'}></span>{#if hasScope(r)}<span class="scope-badge" title="仅对指定目标生效">限定</span>{/if}</strong><small class="path" title={r.path}>{r.path}</small></div>
                      </div>
                      <select class="line-select" bind:value={r.line} on:change={onRuleLineChange} title="规则=智能分流(大陆直连)·全局=全走节点·直连=不走代理·拦截=断网">
                        <option value="rule">规则</option>
                        <option value="global">全局</option>
                        <option value="direct">直连</option>
                        <option value="block">拦截</option>
                      </select>
                      <select class="line-select node-select" bind:value={r.node} on:change={onRuleLineChange} disabled={r.line === 'direct' || r.line === 'block'} title="该应用走哪个节点">
                        <option value="">活动节点{activeNodeObj ? ` · ${latencyText(activeNodeObj.latency)}` : ''}</option>
                        {#each nodes as n}<option value={n.id}>{nodeOptionLabel(n)}</option>{/each}
                      </select>
                      <label class="switch ctr"><input type="checkbox" checked={r.enabled} on:change={() => toggleRule(r)} /><i></i></label>
                      <div class="row-actions ctr">
                        <button class="mini test" class:ok={(appLat[r.match] ?? -100) >= 0} class:err={appLat[r.match] === -1 || appLat[r.match] === -2} on:click={() => testApp(r)} title="测试此应用的连通与延迟">{latText(appLat[r.match])}</button>
                        <button class="icon-btn scope-btn" class:on={hasScope(r) || scopeOpen[i]} on:click={() => toggleScope(i)} title="目标条件：只对指定域名/IP/端口生效">{@html I.target}</button>
                        <button class="icon-btn danger" on:click={() => removeRule(r)} title="删除规则">{@html I.trash}</button>
                      </div>
                    </div>
                    {#if scopeOpen[i]}
                      <div class="scope-row">
                        <div class="scope-grid">
                          <label>域名后缀<input value={(r.domains || []).join(', ')} on:input={(e) => { r.domains = parseList(e.currentTarget.value) }} on:change={pushRules} placeholder="如 google.com, openai.com" /></label>
                          <label>IP / 段<input value={(r.ips || []).join(', ')} on:input={(e) => { r.ips = parseList(e.currentTarget.value) }} on:change={pushRules} placeholder="如 1.1.1.1/32, 10.0.0.0/8" /></label>
                          <label>端口<input value={(r.ports || []).join(', ')} on:input={(e) => { r.ports = parseList(e.currentTarget.value) }} on:change={pushRules} placeholder="如 443, 8000-9000" /></label>
                        </div>
                        <p class="scope-hint">填了条件后，<b>{ruleName(r)}</b> 只有访问这些目标的流量才按「{r.line === 'direct' ? '直连' : r.line === 'block' ? '拦截' : r.line === 'global' ? '全局' : '规则'}」走，其余流量按默认；三项全空 = 整个应用。多个用逗号分隔。</p>
                      </div>
                    {/if}
                  {/each}
                  {#if rules.length === 0}<div class="empty">还没有规则。点右上角「添加规则」，选择要走代理的程序即可。</div>{/if}
                </div>
              </div>

              <div class="rfoot">
                <span class="modes-k">当前：<b>{ruleMode === 'whitelist' ? '只代理列出的' : '默认全走代理'}</b> · 共 {ruleCount} 条</span>
                <button class="ghost-btn danger" on:click={clearRules}>{@html I.trash} 清空规则</button>
              </div>
            </section>
          </div>

          <aside class="col-rail">
            <section class="card">
              <div class="card-head sm"><h3>节点连通 / 速度</h3><button class="link" on:click={testAllLatency} disabled={latencyTesting}>{@html I.refresh} {latencyTesting ? '检测中…' : '检测全部'}</button></div>
              <div class="nrail-head"><span>节点名称</span><span title="到节点边缘的 TCP 传输层延迟">TCP</span><span title="经完整代理链路访问 Google 的端到端延迟">Google</span><span>下载速度</span></div>
              {#each (useDemo ? demoNodes : nodes).slice(0, 6) as n}
                <div class="nrail-row" class:sel={n.id === status?.selectedId} on:dblclick={() => selectNode(n.id)}>
                  <div class="nrail-name"><span class="flag {n.region || 'x'}"></span>{n.name}{#if n.id === status?.selectedId}<span class="active-badge">活动</span>{/if}</div>
                  <span class="lat tcp" data-q={qual(n.tcpLatency)}>{tcpLatencyText(n.tcpLatency)}</span>
                  <span class="lat" data-q={qual(n.latency)}>{latencyText(n.latency)}</span>
                  <div class="spd"><b>{n.speed?.toFixed(2) ?? '—'}</b> MB/s <span class="bars" data-q={qual(n.latency)}>{@html I.bars}</span></div>
                </div>
              {/each}
              {#if !useDemo && nodes.length === 0}
                <div class="empty sm">还没有节点，去「节点」页添加</div>
              {/if}
              <button class="rail-more" on:click={() => (tab = 'nodes')}>
                {(useDemo ? demoNodes.length : nodes.length) > 0 ? `查看所有节点 (${useDemo ? demoNodes.length : nodes.length})` : '去添加节点'} {@html I.chevron}
              </button>
            </section>

            <section class="card">
              <div class="card-head sm"><h3>最新日志</h3><button class="link" on:click={() => (tab = 'logs')}>更多</button></div>
              <div class="rlog">
                {#each recent as l}
                  <div class="rlog-row"><span class="t">{l.time}</span><span class="lv {l.level}">{l.level}</span><span class="m">{l.msg}</span></div>
                {/each}
                {#if recent.length === 0}<div class="empty sm">暂无日志</div>{/if}
              </div>
            </section>
          </aside>
        </div>

      {:else if tab === 'nodes'}
        <div class="page-head">
          <div><h1>节点管理</h1><p>导入区域和节点列表左右分栏，减少空白并提升操作效率。</p></div>
          <div class="head-actions"><button class="btn" on:click={testAllLatency} disabled={latencyTesting}>⟳ {latencyTesting ? 'Google 检测中…' : '检测全部可用性'}</button><button class="btn" on:click={runSpeedTest} disabled={speedTesting}>{speedTesting ? '下载测速中…' : '测活动节点速度'}</button><button class="btn primary" on:click={() => (tab = 'subs')}>＋ 添加订阅</button></div>
        </div>
        <section class="node-manager-v2">
          <div class="card node-import-card">
          <div class="card-head">
            <div><h3>添加节点</h3><p class="sub">链接导入或手动填写代理信息</p></div>
            <div class="actions">
              {#if speedMsg}<span class="speed-msg" class:err={speedMsg.indexOf('失败') === 0}>{speedMsg}</span>{/if}
              <button class="ghost-btn" on:click={() => (showManual = !showManual)}>{@html I.plus} 手动添加</button>
            </div>
          </div>
          <div class="node-import-body"><div class="tabs"><button class:active={!showManual} on:click={() => (showManual = false)}>链接导入</button><button class:active={showManual} on:click={() => (showManual = true)}>手动添加</button></div>
          {#if !showManual}<div class="field-label">分享链接</div><textarea class="textarea" bind:value={linkText} placeholder="每行粘贴一个链接&#10;vless://  vmess://  trojan://&#10;ss://  socks://  http://"></textarea><div class="hint">支持一次导入多个节点，重复节点会自动跳过。</div><div class="form-actions"><button class="btn primary grow" on:click={addNodes}>解析并添加</button><button class="btn" on:click={() => (linkText = '')}>清空</button></div>{/if}
          {#if addMsg}<div class="toast">{addMsg}</div>{/if}
          {#if showManual}
            <div class="manual-form">
              <div class="mf-head">手动添加代理（SOCKS5 / HTTP 常用「地址+端口+账号密码」，没有分享链接时用这里）</div>
              <div class="mf-row">
                <select bind:value={manual.type}>
                  <option value="socks">SOCKS5</option>
                  <option value="http">HTTP</option>
                </select>
                <input bind:value={manual.name} placeholder="名称（可选）" />
                <input class="grow" bind:value={manual.server} placeholder="地址 / 域名" />
                <input class="mf-port" type="number" bind:value={manual.port} placeholder="端口" />
              </div>
              <div class="mf-row">
                <input bind:value={manual.username} placeholder="用户名（可选）" />
                <input bind:value={manual.password} placeholder="密码（可选）" />
                <button class="primary" on:click={submitManual}>添加</button>
                <button class="ghost-btn" on:click={() => { showManual = false; manualMsg = '' }}>取消</button>
              </div>
              {#if manualMsg}<div class="toast err">{manualMsg}</div>{/if}
            </div>
          {/if}
          </div></div>
          <div class="card node-list-card"><div class="card-head"><div><h3>节点列表 <span class="status-pill gray">{nodes.length} 个</span></h3><p class="sub">“可用”表示已通过该节点访问 Google HTTPS 并收到 HTTP 204</p></div><div class="searchbar"><span>⌕</span><input bind:value={query} placeholder="搜索节点名称、地址或类型" /></div></div>
          <div class="tscroll">
            <div class="ntable">
              <div class="nhead"><span>节点</span><span title="到节点边缘的 TCP 传输层延迟(直连测得,反映线路可达性)">TCP 延迟</span><span title="经完整代理链路访问 Google HTTPS 的端到端延迟(反映真实可用性)">Google 延迟</span><span>速度</span><span class="ctr">操作</span></div>
              {#each nodes.filter((n) => !query || `${n.name}${n.server}${n.type}`.toLowerCase().includes(query.toLowerCase())) as n}
                <div class="nrow" class:sel={n.id === status?.selectedId} on:dblclick={() => selectNode(n.id)}>
                  <div class="ncell">
                    <span class="badge">{n.type}</span>
                    <div class="nmeta"><strong>{n.name}</strong><small class="muted">{n.server}:{n.port}</small></div>
                  </div>
                  <span class="lat tcp" data-q={qual(n.tcpLatency)}>{tcpLatencyText(n.tcpLatency)}</span>
                  <span class="lat" data-q={qual(n.latency)}>{latencyText(n.latency)}</span>
                  <span class="nspd">{n.speed?.toFixed(2) ?? '—'} MB/s</span>
                  <div class="row-actions ctr"><div class="test-group"><button class="mini test tcp" on:click={() => testNodeTCP(n)} disabled={!!tcpTestingId} title="测传输层 TCP 延迟（快，不启动核心）">{tcpTestingId === n.id ? '…' : '测TCP'}</button><button class="mini test" on:click={() => testNodeGoogle(n)} disabled={!!latencyTestingId} title="测完整代理链路访问 Google 的延迟">{latencyTestingId === n.id ? '…' : '测Google'}</button><button class="mini test spd" on:click={() => testNodeSpeed(n)} disabled={!!speedTestingId} title="测经该节点的下载速度">{speedTestingId === n.id ? '…' : '测速度'}</button></div><button class="mini" on:click={() => selectNode(n.id)}>设为活动</button><button class="icon-btn" on:click={() => showQR(n)} title="分享二维码">{@html I.qr}</button><button class="icon-btn danger" on:click={() => removeNode(n.id)} title="删除节点">{@html I.trash}</button></div>
                </div>
              {/each}
              {#if nodes.length === 0}<div class="empty">还没有节点。粘贴分享链接点「从链接添加」，或点「手动添加」填 SOCKS5 / HTTP 代理。</div>{/if}
            </div>
          </div>
          <div class="node-list-foot"><span class="hint">提示：点击“设为活动”即可切换当前节点</span></div></div>
        </section>

      {:else if tab === 'rules'}
        <div class="page-head">
          <div><h1>分流规则</h1><p>预置规则库、自定义规则与自定义线路分区展示。</p></div>
          <div class="head-actions"><button class="btn" on:click={updateRuleSets}>检查更新</button><button class="btn primary" on:click={newLine}>＋ 新建线路</button></div>
        </div>
        <section class="card page rules-library-v2">
          <div class="card-head">
            <div><h3>分流规则库</h3><p class="sub">决定「哪些网站/IP 走代理、哪些直连」的地区规则(geosite / geoip)。「代理策略」选「规则」时,靠这套库判断大陆直连、境外走代理。</p></div>
            <div class="actions">
              <button class="primary" on:click={updateRuleSets} disabled={ruleSetMsg === '更新中…'}>{@html I.refresh} {ruleSetMsg === '更新中…' ? '更新中…' : '手动更新规则库'}</button>
              {#if ruleSetMsg && ruleSetMsg !== '更新中…'}<span class="rs-msg" class:err={ruleSetMsg.indexOf('失败') === 0}>{ruleSetMsg}</span>{/if}
            </div>
          </div>
          <div class="rs-list">
            <div class="rs-head"><span></span><span>规则库</span><span>状态</span><span class="r">大小 / 更新日期</span></div>
            {#each ruleSets as rs}
              <div class="rs-row" class:disabled={!rs.enabled}>
                <span class="lh-dot" class:ok={rs.present} class:bad={!rs.present}></span>
                <div class="rs-meta"><strong>{rs.display}</strong><small>{rs.desc}</small></div>
                <label class="switch" title={rs.enabled ? '点击停用' : '点击启用'}><input type="checkbox" checked={rs.enabled} on:change={() => toggleRuleSet(rs)} /><i></i></label>
                <div class="rs-info r">{#if rs.present}<b>{rs.sizeKB} KB</b><small>更新于 {rs.modified}</small>{:else}<span class="rs-miss">缺失</span>{/if}</div>
              </div>
            {/each}
            {#if ruleSets.length === 0}<div class="empty sm">暂无规则库信息</div>{/if}
          </div>
          <div class="setting"><span>添加节点后自动更新规则库<small class="setting-hint">勾上后:每次加完节点自动更新一次。需代理运行中(规则库源在墙外,走节点下载)。默认关,手动更新更可控。</small></span><label class="switch"><input type="checkbox" bind:checked={settings.autoUpdateRules} on:change={saveSettings} /><i></i></label></div>
          <p class="rs-note">📦 规则库来自 sing-box 官方(SagerNet),已内置最新版。更新走<b>当前节点</b>下载(直连被墙),所以更新前请先「启动」并连上节点。</p>
        </section>

        <section class="card page custom-rules-v2">
          <div class="card-head">
            <div><h3>自定义规则</h3><p class="sub">你自己填的规则,盖过上面的国内外分流,「代理策略」为「规则」时生效。应用单独设的「直连 / 拦截」优先于它;「只代理列出的」时,「走代理」只作用于列出的应用。</p></div>
            <div class="actions">
              <button class="ghost-btn" on:click={addCustomRule}>{@html I.plus} 加一条</button>
              <button class="primary" on:click={saveCustomRules} disabled={custRuleMsg === '应用中…'}>{custRuleMsg === '应用中…' ? '应用中…' : '保存并应用'}</button>
              {#if custRuleMsg && custRuleMsg !== '应用中…'}<span class="rs-msg">{custRuleMsg}</span>{/if}
            </div>
          </div>
          <div class="cr-list">
            {#if customRules.length > 0}<div class="cr-head"><span>匹配方式</span><span>内容</span><span>动作</span><span></span></div>{/if}
            {#each customRules as r, i}
              <div class="cr-row">
                <select bind:value={r.type}>
                  <option value="suffix">域名后缀</option>
                  <option value="domain">完整域名</option>
                  <option value="keyword">关键字</option>
                  <option value="ip">IP 段(CIDR)</option>
                </select>
                <input bind:value={r.value} placeholder={r.type === 'ip' ? '如 1.1.1.1/32、10.0.0.0/8' : r.type === 'keyword' ? '如 google' : '如 github.com'} />
                <select bind:value={r.action}>
                  <option value="proxy">走代理</option>
                  <option value="direct">直连</option>
                  <option value="block">拦截</option>
                </select>
                <button class="icon-btn danger" on:click={() => removeCustomRule(i)} title="删除">{@html I.trash}</button>
              </div>
            {/each}
            {#if customRules.length === 0}<div class="empty sm">还没有自定义规则。点「加一条」添加 —— 比如「github.com → 走代理」、「某国内网站 → 直连」、「广告域名 → 拦截」。填完点「保存并应用」。</div>{/if}
          </div>
        </section>

        <section class="card route-card">
          <div class="route-top">
            <div class="route-title">
              <h3>线路管理</h3>
              <p class="sub">每条线路 = 一个出口节点 + 一套分流策略。上面的应用规则里为每个应用挑选走哪条线路。总开关已并入顶部「代理策略」。</p>
            </div>
          </div>

          <div class="route-actions">
            <span class="rs-hint">「绕过大陆」等智能分流依赖地区规则库 —— 更新它请去左侧「分流规则」页。</span>
          </div>

          <div class="line-list">
            <div class="line-list-head"><span>线路</span><span>出口</span><span>分流模式</span><span class="ctr">操作</span></div>
            {#each lines.filter((l) => !l.builtin) as l}
              <div class="line-row">
                <div class="line-name"><strong>{l.name}</strong></div>
                <span class="line-exit">{lineNodeLabel(l.node)}</span>
                <span class="line-mode">{modeLabel(l.routing.mode)}</span>
                <div class="row-actions ctr">
                  <button class="mini" on:click={() => editLine(l)}>编辑</button>
                  <button class="icon-btn danger" on:click={() => deleteLine(l)} title="删除线路">{@html I.trash}</button>
                </div>
              </div>
            {/each}
            {#if lines.filter((l) => !l.builtin).length === 0}<div class="empty sm">还没有自定义线路。内置线路：直连 / 全局 / 规则（绕过大陆）/ 拦截。点下面「新建线路」添加。</div>{/if}
          </div>

          {#if !showLineForm}
            <div class="line-tools"><button class="primary" on:click={newLine}>{@html I.plus} 新建线路</button></div>
          {/if}

          {#if showLineForm}
            <div class="line-form">
              <div class="lf-head">{lineForm.id ? '编辑线路' : '新建线路'}</div>
              <div class="lf-grid">
                <label class="lf-field"><span>名称</span><input bind:value={lineForm.name} placeholder="如 美区-全局" /></label>
                <label class="lf-field"><span>出口</span>
                  <select bind:value={lineForm.node}>
                    <option value="active">跟随活动节点</option>
                    {#each nodes as n}<option value={n.id}>{nodeOptionLabel(n)}</option>{/each}
                    <option value="direct">直连</option>
                  </select>
                </label>
                <label class="lf-field"><span>分流模式</span>
                  <select bind:value={lineForm.mode}>
                    <option value="global">全局</option>
                    <option value="bypass_cn">绕过大陆</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
              </div>
              {#if lineForm.mode === 'custom'}
                <div class="route-rules">
                  {#each lineForm.rules as r, i}
                    <div class="route-rule">
                      <select bind:value={r.type}>
                        <option value="suffix">域名后缀</option>
                        <option value="domain">完整域名</option>
                        <option value="keyword">关键字</option>
                        <option value="ip">IP 段(CIDR)</option>
                      </select>
                      <input bind:value={r.value} placeholder={r.type === 'ip' ? '如 10.0.0.0/8' : '如 google.com'} />
                      <select bind:value={r.action}>
                        <option value="proxy">走代理</option>
                        <option value="direct">直连</option>
                        <option value="block">拦截</option>
                      </select>
                      <button class="icon-btn danger" on:click={() => removeLineRule(i)} title="删除此规则">{@html I.trash}</button>
                    </div>
                  {/each}
                  {#if lineForm.rules.length === 0}<div class="empty sm">还没有自定义规则。点下面「添加规则」新增一条。</div>{/if}
                  <button class="mini" on:click={addLineRule}>{@html I.plus} 添加规则</button>
                </div>
              {/if}
              <div class="lf-foot">
                <button class="primary" on:click={saveLine}>保存线路</button>
                <button class="ghost-btn" on:click={() => (showLineForm = false)}>取消</button>
              </div>
            </div>
          {/if}
        </section>

      {:else if tab === 'subs'}
        <div class="page-head">
          <div><h1>订阅管理</h1><p>订阅状态、节点数量和更新时间一目了然。</p></div>
          <div class="head-actions"><button class="btn" on:click={refreshSubs}>全部刷新</button><button class="btn primary" on:click={() => (showSubForm = true)}>＋ 添加订阅</button></div>
        </div>
        <section class="card page subs-page-v2">
          <div class="card-head"><div><h3>订阅</h3><p class="sub">名称、URL、节点数、上次更新、自动更新</p></div><button class="primary" on:click={() => (showSubForm = !showSubForm)}>{@html I.plus} 添加订阅</button></div>
          {#if showSubForm}
            <div class="picker">
              <div class="picker-foot">
                <input class="grow" bind:value={subName} placeholder="订阅名称" />
                <input class="grow" bind:value={subUrl} placeholder="订阅 URL（http/https）" on:keydown={(e) => e.key === 'Enter' && submitSub()} />
                <span class="node-col">自动更新</span>
                <label class="switch"><input type="checkbox" bind:checked={subAuto} /><i></i></label>
                <button class="mini" on:click={submitSub}>添加</button>
                <button class="mini" on:click={() => (showSubForm = false)}>收起</button>
              </div>
            </div>
          {/if}
          <div class="sub-list">
            {#each subs as s}
              <div class="sub-row" class:editing={editingSubId === s.id}>
                {#if editingSubId === s.id}
                  <div class="sub-edit-fields">
                    <label>订阅名称<input bind:value={editSubName} placeholder="订阅名称" /></label>
                    <label>订阅地址<input bind:value={editSubUrl} placeholder="https://..." on:keydown={(e) => e.key === 'Enter' && saveSubEdit(s)} /></label>
                  </div>
                {:else}
                  <div class="sub-meta"><strong>{s.name}</strong><small title={s.url}>{s.url}</small></div>
                {/if}
                <span class="sub-count">{s.nodeCount} 节点</span>
                <span class="muted">{s.lastUpdate || '手动'}</span>
                <div class="row-actions">
                  <span class="node-col">自动更新</span>
                  <label class="switch"><input type="checkbox" checked={s.autoUpdate} on:change={() => toggleSubAuto(s)} /><i></i></label>
                  {#if subMsg[s.id]}<span class="rs-msg" class:err={subMsg[s.id].includes('失败')}>{subMsg[s.id]}</span>{/if}
                  {#if editingSubId === s.id}
                    <button class="mini primary" on:click={() => saveSubEdit(s)} disabled={subMsg[s.id] === '保存中…'}>保存并更新</button>
                    <button class="mini" on:click={cancelEditSub}>取消</button>
                  {:else}
                    <button class="mini" on:click={() => startEditSub(s)}>编辑</button>
                    <button class="mini" on:click={() => updateSub(s.id)} disabled={subMsg[s.id] === '更新中…'}>更新</button>
                    <button class="icon-btn danger" on:click={() => removeSub(s.id)} title="删除订阅">{@html I.trash}</button>
                  {/if}
                </div>
              </div>
            {/each}
            {#if subs.length === 0}<div class="empty">还没有订阅，粘贴机场订阅链接添加</div>{/if}
          </div>
        </section>

      {:else if tab === 'logs'}
        <div class="page-head">
          <div><h1>运行诊断</h1><p>每条连接命中了哪条规则、走了哪个出口，一目了然；下方是原始日志。</p></div>
          <div class="head-actions"><button class="btn" on:click={() => (logs = [])}>清空日志</button></div>
        </div>
        <section class="card">
          <div class="card-head"><div><h3>实时连接 · 诊断</h3><p class="sub">进程 → 目标 → 命中规则 → 出口（{filteredConns.length} 条活动连接）</p></div><div class="actions"><input bind:value={connFilter} placeholder="按进程 / 目标 / 规则过滤" /></div></div>
          <div class="conn-table">
            <div class="conn-head"><span>进程</span><span>目标</span><span>命中规则</span><span>出口</span><span class="r">↑ / ↓</span></div>
            {#each filteredConns as c}
              <div class="conn-row">
                <span class="conn-proc" title={c.process}>{c.process || '—'}</span>
                <span class="conn-dest" title={c.dest}>{c.host || c.dest || '—'}{#if c.network}<small>{c.network}</small>{/if}</span>
                <span class="conn-rule" title={c.rule}>{c.rule || '—'}</span>
                <span class="conn-out" data-o={outClass(c)}>{c.outbound || '—'}</span>
                <span class="conn-tx r">↑{fmtBytes(c.upload)} ↓{fmtBytes(c.download)}</span>
              </div>
            {/each}
            {#if filteredConns.length === 0}<div class="lg-empty">{running ? (connFilter ? '无匹配连接' : '暂无活动连接（产生流量后自动出现）') : '核心未运行 —— 到概览启动分流后这里显示实时连接'}</div>{/if}
          </div>
        </section>

        <section class="card log-full">
          <div class="card-head"><div><h3>实时日志</h3><p class="sub">核心 + 分流引擎 + 每条连接</p></div><div class="actions"><input bind:value={logFilter} placeholder="过滤（支持关键字）" /><button class="ghost-btn" on:click={() => (logs = [])}>清空</button></div></div>
          <div class="logbox">
            {#each parsedLogs as p}
              <div class="lg-line {p.level.toLowerCase()}">
                <span class="lg-time">{p.time || '—'}</span>
                <span class="lg-lv {p.level.toLowerCase()}">{p.level}</span>
                {#if p.tag}<span class="lg-tag">{p.tag}</span>{/if}
                <span class="lg-msg">{p.msg}</span>
              </div>
            {/each}
            {#if parsedLogs.length === 0}<div class="lg-empty">暂无日志</div>{/if}
          </div>
        </section>

      {:else}
        <div class="page-head">
          <div><h1>设置</h1><p>网络、内核、系统集成和维护选项。</p></div>
          <div class="head-actions"><button class="btn" on:click={exportConfig}>导出配置</button><button class="btn" on:click={importConfig}>导入配置</button></div>
        </div>
        <div class="settings-grid">
          {#if license.enabled}
            <section class="card account-card">
              <div class="card-head sm">
                <div><h3>账户与设备授权</h3><p class="sub">当前账号已绑定到本机，退出账号会同时停止代理服务。</p></div>
                <span class="pill good">● 已授权</span>
              </div>
              <div class="account-grid">
                <div><span>用户名</span><b>{license.username}</b></div>
                <div><span>套餐</span><b>{license.plan || '默认套餐'}</b></div>
                <div><span>授权到期</span><b>{license.expiresAt ? new Date(license.expiresAt).toLocaleString() : '以服务端为准'}</b></div>
                <div><span>离线可用至</span><b>{license.offlineUntil ? new Date(license.offlineUntil).toLocaleString() : '需在线校验'}</b></div>
              </div>
              <div class="pw-block">
                <div class="pw-head"><div><b>修改密码</b><small>输入原密码即可修改，修改后其它设备需重新登录</small></div></div>
                <form class="pw-form" on:submit|preventDefault={changePassword}>
                  <input type="password" placeholder="原密码" bind:value={pwCurrent} disabled={pwBusy} autocomplete="current-password" />
                  <input type="password" placeholder="新密码（至少 8 位）" bind:value={pwNext} disabled={pwBusy} autocomplete="new-password" />
                  <button type="submit" disabled={pwBusy || !pwCurrent || pwNext.length < 8}>{pwBusy ? '修改中…' : '确认修改'}</button>
                </form>
                {#if pwMsg}<p class="pw-msg" class:bad={pwErr}>{pwMsg}</p>{/if}
              </div>
              <div class="settings-devices">
                <div class="settings-devices-head"><div><b>设备管理</b><small>{accountDevices.length} / {license.maxDevices || '—'} 台，旧设备可在这里直接解绑</small></div><button class="mini" on:click={loadCommerce} disabled={commerceLoading}>{commerceLoading ? '刷新中…' : '刷新设备'}</button></div>
                {#if deviceLoadError}
                  <div class="settings-device-error"><span>{deviceLoadError}</span><button class="mini danger" on:click={logoutAccount}>退出并重新登录</button></div>
                {:else}{#each accountDevices as device}
                  <div class="settings-device-row">
                    <div><b>{device.name}</b><small>{device.platform || 'Windows'} · v{device.appVersion || '未知'} · 最近在线 {new Date(device.lastSeenAt).toLocaleString()}</small></div>
                    <div>{#if device.current}<span class="current-device-light">本机</span>{/if}<button class="mini danger" disabled={device.current} title={device.current ? '当前正在使用的本机不能解绑' : '解绑此旧设备'} on:click={() => unbindDevice(device.id)}>解绑</button></div>
                  </div>
                {:else}
                  <div class="settings-device-empty">暂无已绑定设备，点击“刷新设备”重新读取服务端状态。</div>
                {/each}{/if}
              </div>
              <div class="account-actions">
                <button class="primary" on:click={openMembership}>续费 / 升级套餐</button>
                <button class="ghost-btn" on:click={async () => { const err = await WRefreshEntitlement(); if (err) toast(err); await refreshLicense() }}>刷新授权</button>
                <button class="ghost-btn danger" on:click={logoutAccount}>退出账号</button>
              </div>
            </section>
          {/if}
          <section class="card ai-card">
            <div class="card-head sm">
              <div><h3>🤖 AI 控制（MCP / API）</h3><p class="sub">让 AI（Claude Code / Codex 等）直接控制本机代理：把某程序设为走代理 / 直连 / 全局、启停</p></div>
              <span class="ai-dot" class:on={aiInfo.running}>{aiInfo.running ? '● 已就绪' : '○ 未启动'}</span>
            </div>
            <div class="ai-row"><span class="ai-k">接口地址</span><code class="ai-v">{aiInfo.url}</code><button class="mini" on:click={() => copyText(aiInfo.url, '地址')}>复制</button></div>
            <div class="ai-row"><span class="ai-k">Token</span><code class="ai-v">{aiTokenShown ? aiInfo.token : aiTokenMasked}</code><button class="mini" on:click={() => (aiTokenShown = !aiTokenShown)}>{aiTokenShown ? '隐藏' : '显示'}</button><button class="mini" on:click={() => copyText(aiInfo.token, 'Token')}>复制</button></div>
            <div class="ai-actions">
              <button class="primary ai-big" on:click={() => copyText(aiInfo.prompt, 'AI 提示词')}>{@html I.exp} 一键复制 AI 提示词</button>
              <button class="ghost-btn" on:click={() => copyText(aiInfo.mcpConfig, 'MCP 配置')}>复制 MCP 配置</button>
              {#if aiMsg}<span class="rs-msg">{aiMsg}</span>{/if}
            </div>
            <p class="ai-hint">用法：点「一键复制 AI 提示词」→ 粘贴给你的 AI（Claude Code / Codex）→ 直接说「让 Chrome 走代理」即可。提示词已内置接口地址与 Token，AI 用 curl 就能控制。Token 等于本机代理控制权，别外发。</p>
          </section>
          <section class="card">
            <h3>内核 &amp; 诊断</h3>
            <div class="setting"><span>ProxySplit 版本<small class="setting-hint">正式版自动检查签名更新，升级后会自动重启且不会改动节点和规则</small></span><div class="core-update"><strong>v{appUpdate.current}</strong><button class="mini" on:click={() => checkAppUpdate(false)} disabled={appUpdateBusy}>{appUpdateBusy ? '检查中…' : '检查软件更新'}</button></div></div>
            <div class="setting"><span>自动检查软件更新<small class="setting-hint">启动后连接官方更新服务；只有签名和 SHA256 都正确才允许安装</small></span><label class="switch"><input type="checkbox" bind:checked={settings.autoUpdateApp} on:change={saveSettings} /><i></i></label></div>
            <div class="setting"><span>sing-box 版本</span><strong>{coreVersion || '1.13.14'}</strong></div>
            <div class="setting"><span>更新内核<small class="setting-hint">从 GitHub 拉最新版（走当前节点）</small></span><div class="core-update"><button class="mini" on:click={updateCore} disabled={coreMsg === '检查中…'}>{@html I.dl} 更新内核</button>{#if coreMsg}<span class="rs-msg" class:err={coreMsg.indexOf('失败') === 0}>{coreMsg}</span>{/if}</div></div>
            <div class="setting"><span>本地端口<small class="setting-hint">混合入站 SOCKS5 + HTTP，自动分配</small></span><strong>{running ? (status?.corePort || '—') : '未运行'}</strong></div>
            <div class="setting"><span>日志级别</span><select class="sel" value={logLevel} on:change={changeLogLevel}><option value="error">error</option><option value="warn">warn</option><option value="info">info</option><option value="debug">debug</option></select></div>
            <div class="setting"><span>配置备份<small class="setting-hint">节点 / 规则 / 线路 / 设置 全部存到文件，换机可导回</small></span><div class="cfg-io"><button class="mini" on:click={exportConfig}>{@html I.exp} 导出</button><button class="mini" on:click={importConfig}>{@html I.imp} 导入</button></div></div>
            <div class="setting"><span>重置为默认配置<small class="setting-hint">恢复默认设置、清空应用规则/自定义线路 —— <b>保留</b>你的节点和订阅</small></span><button class="mini danger" on:click={resetConfig}>{@html I.refresh} 重置</button></div>
          </section>
          <section class="card">
            <h3>分流引擎</h3>
            <div class="setting"><span>阻止 QUIC 协议<small class="setting-hint">部分浏览器/视频用的新加密协议,不挡住会绕过分流导致代理失效。建议开</small></span><label class="switch"><input type="checkbox" bind:checked={settings.blockQUIC} on:change={saveSettings} /><i></i></label></div>
            <div class="setting"><span>远程解析域名<small class="setting-hint">把域名交给节点解析,防止运营商劫持/污染。建议开</small></span><label class="switch"><input type="checkbox" bind:checked={settings.remoteDNS} on:change={saveSettings} /><i></i></label></div>
            <div class="setting"><span>内网直连<small class="setting-hint">访问路由器/NAS/公司内网这类本地地址时不走代理。建议开</small></span><label class="switch"><input type="checkbox" bind:checked={settings.privateDirect} on:change={saveSettings} /><i></i></label></div>
            <div class="setting"><span>代理程序自身不走代理<small class="setting-hint">避免流量绕圈/死循环。建议开</small></span><label class="switch"><input type="checkbox" bind:checked={settings.excludeSelf} on:change={saveSettings} /><i></i></label></div>
          </section>
          <section class="card">
            <h3>系统集成</h3>
            <div class="setting"><span>代理范围<small class="setting-hint">指定应用分流，或接管整台电脑</small></span><div class="mode-seg sm"><button class:on={!settings.tunMode} on:click={() => setCaptureMode(false)}>应用分流</button><button class:on={settings.tunMode} on:click={() => setCaptureMode(true)}>整机全局</button></div></div>
            <div class="setting"><span>系统代理<small class="setting-hint">不需要开启：应用分流和整机全局都用虚拟网卡接管流量,只认系统代理的程序也会被正常分流</small></span><label class="switch"><input type="checkbox" checked={false} disabled /><i></i></label></div>
            <div class="setting"><span>对局域网开放<small class="setting-hint">手机/平板也能连本机代理（重启内核生效）</small></span><label class="switch"><input type="checkbox" bind:checked={settings.lanShare} on:change={saveSettings} /><i></i></label></div>
            {#if settings.lanShare}
              <div class="lan-cfg">
                <div class="lan-row">
                  <label class="lan-field"><span>端口</span><input type="number" min="1" max="65535" bind:value={settings.lanPort} on:change={saveSettings} /></label>
                  <label class="lan-field"><span>类型</span>
                    <select bind:value={settings.lanType} on:change={saveSettings}>
                      <option value="mixed">混合 SOCKS5+HTTP</option>
                      <option value="socks">SOCKS5</option>
                      <option value="http">HTTP</option>
                    </select>
                  </label>
                </div>
                <div class="lan-row">
                  <label class="lan-field"><span>用户名</span><input bind:value={settings.lanUser} on:change={saveSettings} placeholder="留空 = 免验证" /></label>
                  <label class="lan-field"><span>密码</span><input type="password" bind:value={settings.lanPass} on:change={saveSettings} placeholder="留空 = 免验证" /></label>
                </div>
                <p class="lan-hint">
                  局域网设备代理设为 <b>{lanIP || '本机IP'}:{settings.lanPort || 7890}</b>
                  （{settings.lanType === 'http' ? 'HTTP' : settings.lanType === 'socks' ? 'SOCKS5' : 'SOCKS5 / HTTP'}）。
                  {settings.lanUser ? '连接需填此用户名和密码。' : '当前免验证，任何同网设备都可用，建议设个密码。'}
                </p>
              </div>
            {/if}
            <div class="setting"><span>开机自启<small class="setting-hint">登录 Windows 后自动运行</small></span><label class="switch"><input type="checkbox" checked={autostart} on:change={toggleAutostart} /><i></i></label></div>
            <div class="setting"><span>关闭到托盘<small class="setting-hint">点 × 最小化到托盘而非退出</small></span><label class="switch"><input type="checkbox" bind:checked={settings.trayClose} on:change={saveSettings} /><i></i></label></div>
            <div class="setting"><span>主题</span><div class="mode-seg sm"><button class:on={themePref === 'light'} on:click={() => setTheme('light')}>亮</button><button class:on={themePref === 'dark'} on:click={() => setTheme('dark')}>暗</button><button class:on={themePref === 'system'} on:click={() => setTheme('system')}>跟随</button></div></div>
          </section>
        </div>
      {/if}
      </div>
    </div>

    <footer class="statusbar">
      <div class="sb-left"><span class="sb-k">本地</span> {running ? (status?.corePort || '—') : '未运行'} <span class="sep">|</span> HTTP(S) <span class="sep">|</span> 代理策略 <b>{clashLabel(clashMode)}</b></div>
      <div class="sb-right">代理范围：<b class:on={running}>{settings.tunMode ? '整机全局' : '应用分流'}</b><span class="ok" class:on={running}>✓</span></div>
    </footer>
  </section>

  {#if showRedeemDialog}
    <div class="modal-mask" role="button" tabindex="0" aria-label="关闭兑换" on:click|self={() => (showRedeemDialog = false)} on:keydown={(e) => e.key === 'Escape' && (showRedeemDialog = false)}>
      <section class="redeem-modal">
        <div class="redeem-modal-head">
          <div><span class="member-eyebrow">兑换码开通</span><h2>输入兑换码 / 授权码</h2></div>
          <button class="icon-btn" title="关闭" on:click={() => (showRedeemDialog = false)}>✕</button>
        </div>
        <p class="redeem-modal-tip">当前账号 <b>{license.username || '未登录'}</b>。输入后立即按码上的会员等级与时长开通，无需支付。同一账号对同一个兑换码只能兑换一次。</p>
        <form class="redeem-form vertical" on:submit|preventDefault={redeem}>
          <input placeholder="输入兑换码，如 PS-XXXX-XXXX-XXXX" bind:value={redeemInput} disabled={redeemBusy} maxlength="64" />
          <button type="submit" disabled={redeemBusy || !redeemInput.trim()}>{redeemBusy ? '兑换中…' : '立即兑换'}</button>
        </form>
        {#if commerceError}<p class="redeem-modal-err">{commerceError}</p>{/if}
      </section>
    </div>
  {/if}

  {#if showMembership}
    <div class="modal-mask member-modal-mask" role="button" tabindex="0" aria-label="关闭会员中心" on:click|self={() => (showMembership = false)} on:keydown={(e) => e.key === 'Escape' && (showMembership = false)}>
      <section class="member-modal">
        <div class="member-modal-head"><div><span class="member-eyebrow">PROXYSPLIT 会员中心</span><h2>{license.planCode === 'trial' ? '试用期间也可提前开通会员' : license.authenticated ? '续费或升级会员' : '选择适合你的会员方案'}</h2><p>按使用时长和设备数量选择即可，支付成功后会员权益会自动生效。</p></div><div class="member-head-actions"><button class="member-refresh" disabled={commerceLoading} on:click={loadCommerce}>{commerceLoading ? '加载中…' : '重新加载'}</button><button class="icon-btn" title="关闭" on:click={() => (showMembership = false)}>✕</button></div></div>
        <section class="member-account-summary">
          <div><span>当前账号</span><b>{license.username || '未登录'}</b></div>
          <div><span>当前套餐</span><b>{license.plan || '免费试用 / 未开通'}</b></div>
          <div><span>授权到期</span><b>{license.expiresAt ? new Date(license.expiresAt).toLocaleString() : '以支付后授权为准'}</b></div>
          <div><span>已绑设备</span><b>{accountDevices.length} / {license.maxDevices || '—'} 台</b></div>
        </section>
        <section class="redeem-box">
          <div class="redeem-copy"><b>有兑换码 / 授权码？</b><small>输入后立即开通对应会员与时长，无需支付。</small></div>
          <form class="redeem-form" on:submit|preventDefault={redeem}>
            <input placeholder="输入兑换码，如 PS-XXXX-XXXX-XXXX" bind:value={redeemInput} disabled={redeemBusy} maxlength="64" />
            <button type="submit" disabled={redeemBusy || !redeemInput.trim()}>{redeemBusy ? '兑换中…' : '立即兑换'}</button>
          </form>
        </section>
        {#if commerceError}<div class="member-alert">{commerceError}</div>{/if}
        {#if planLoadError}<div class="member-alert plan-load-alert"><span>{planLoadError}</span><button class="member-refresh" on:click={loadCommerce}>重新读取</button></div>{/if}
        <section class="benefit-comparison compact">
          <div class="benefit-title"><div><b>普通会员与超级会员</b><small>功能与协议完全一致，仅同时在线设备数量不同</small></div></div>
          <div class="benefit-grid">
            <div class="benefit-corner">权益项目</div><div class="benefit-tier">普通会员</div><div class="benefit-tier premium">超级会员</div>
            <div>同时在线设备</div><b>{standardReference?.maxDevices || 3} 台</b><b>{premiumReference?.maxDevices || 8} 台</b>
            <div>代理协议</div><b>全部支持</b><b>全部支持</b>
            <div>应用分流规则</div><b>支持</b><b>支持</b>
            <div>自定义线路</div><b>支持</b><b>支持</b>
            <div>功能权益</div><b>完整功能</b><b>完整功能</b>
          </div>
        </section>
        {#if memberPlans.length}
          <div class="plan-sections">
            {#each [
              { key: 'standard', title: '普通会员', note: '适合个人日常使用，支持 3 台设备', plans: standardPlans },
              { key: 'premium', title: '超级会员', note: '功能与普通会员一致，支持 8 台设备', plans: premiumPlans }
            ] as group (group.key)}
              {#if group.plans.length}
                <section class="plan-section">
                  <div class="plan-section-title"><div><h3>{group.title}</h3><p>{group.note}</p></div><span>{group.plans.length} 种时长可选</span></div>
                  <div class="member-plan-grid compact">
                    {#each group.plans as plan (plan.id)}
                      <article class:premium={plan.tier === 'premium'}>
                        <div class="member-plan-top"><span>{plan.badge || plan.name}</span><em>{plan.maxDevices} 台设备</em></div>
                        <h2>{plan.name}</h2>
                        <p>{plan.description || '开通后立即生效，可在有效期内持续使用。'}</p>
                        <strong><small>¥</small>{(plan.priceCents / 100).toFixed(2)}{#if plan.originalPriceCents && plan.originalPriceCents > plan.priceCents}<del>¥{(plan.originalPriceCents / 100).toFixed(2)}</del>{/if}</strong>
                        <div class="plan-highlights"><span>{plan.durationDays || 0} 天</span><span>{plan.maxDevices} 台设备</span><span>{plan.tier === 'premium' ? '全部功能' : '基础功能'}</span></div>
                        <button class="primary" disabled={commerceBusy} on:click={() => buyPlan(plan)}>{commerceBusy ? '请稍候…' : '立即购买'}</button>
                      </article>
                    {/each}
                  </div>
                </section>
              {/if}
            {/each}
            {#each lifetimePlans as plan (plan.id)}
              <article class="lifetime-plan">
                <div class="lifetime-copy"><div class="member-plan-top"><span>{plan.badge || '限时活动'}</span><em>{plan.maxDevices} 台设备</em></div><h3>{plan.name}</h3><p>{plan.description || '一次开通，长期使用超级会员全部功能。'}</p><div class="plan-highlights"><span>永久有效</span><span>{plan.maxDevices} 台设备</span><span>超级会员全部功能</span></div></div>
                <div class="lifetime-buy"><strong><small>¥</small>{(plan.priceCents / 100).toFixed(2)}{#if plan.originalPriceCents && plan.originalPriceCents > plan.priceCents}<del>¥{(plan.originalPriceCents / 100).toFixed(2)}</del>{/if}</strong><button class="primary" disabled={commerceBusy} on:click={() => buyPlan(plan)}>{commerceBusy ? '请稍候…' : '立即购买'}</button></div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="member-plans-empty"><b>{commerceLoading ? '正在加载套餐…' : '暂时无法显示套餐'}</b><span>{commerceLoading ? '请稍候。' : '请检查网络后重新加载。'}</span>{#if !commerceLoading}<button class="primary" on:click={loadCommerce}>重新加载</button>{/if}</div>
        {/if}
        {#if activeOrder}<div class="pay-overlay" role="button" tabindex="0" aria-label="关闭付款" on:click|self={closePayment} on:keydown={(e) => e.key === 'Escape' && closePayment()}><div class="pay-modal"><button class="pay-close" title="关闭" on:click={closePayment}>✕</button><div class="payment-sheet qr-payment">{#if paymentQR}<div class="payment-qr-box"><img src={paymentQR} alt="支付宝付款二维码" /><span>支付宝扫码支付</span></div>{/if}<div class="payment-order-info"><span>支付宝安全支付</span><h3>{activeOrder.planName} · ¥{(activeOrder.amountCents / 100).toFixed(2)}</h3><p>打开手机支付宝扫描左侧二维码，付款完成后刷新到账状态。</p><small>请在 {new Date(activeOrder.expiresAt).toLocaleString()} 前完成支付</small></div><div class="payment-actions"><button class="ghost-btn" on:click={() => activeOrder?.payUrl && WOpenPaymentURL(activeOrder.payUrl)}>本机打开支付宝</button><button class="primary" disabled={commerceBusy} on:click={refreshPayment}>我已支付，刷新到账</button></div></div></div></div>{/if}
      </section>
    </div>
  {/if}

  {#if qrData}
    <div class="modal-mask" role="button" tabindex="0" aria-label="关闭二维码" on:click={closeQRBackdrop} on:keydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && closeQR()}>
      <div class="qr-modal">
        <div class="qr-head"><strong>分享节点</strong><button class="icon-btn" on:click={closeQR} title="关闭">✕</button></div>
        <div class="qr-name">{qrName}</div>
        <img class="qr-img" src={qrData} alt="节点二维码" />
        <p class="qr-hint">用另一台设备的客户端扫码即可导入该节点</p>
      </div>
    </div>
  {/if}

  {#if showDonate}
    <div class="modal-mask donate-mask">
      <div class="donate-modal">
        <div class="donate-title">☕ 支持一下作者</div>
        <img class="donate-img" src={donateQR} alt="微信赞赏码" />
        <p class="donate-hint">微信扫码赞赏，您的支持是我持续开发的最大动力 ❤</p>
        {#if donateLeft > 0}
          <button class="donate-close waiting" disabled>请欣赏 {donateLeft}s…</button>
        {:else}
          <button class="donate-close" on:click={closeDonate}>我知道了，关闭</button>
        {/if}
      </div>
    </div>
  {/if}
</div>
{/if}

<style>
  :global(:root) {
    --bg: #f4f7fb;
    --card: #ffffff;
    --soft: #f8fafc;
    --line: #e6eaf0;
    --line-2: #eef1f6;
    --line-3: #f1f5f9;
    --ink: #172033;
    --ink-2: #536076;
    --muted: #7a879b;
    --muted-2: #9aa6b8;
    --brand: #2864e8;
    --brand-600: #2457cf;
    --brand-tint: #edf3ff;
    --ok: #18a566;
    --ok-600: #138755;
    --ok-tint: #eaf9f1;
    --danger: #e15361;

    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 20px; --s6: 24px; --s7: 32px;
    --r1: 8px; --r2: 10px; --r3: 12px; --r4: 14px; --r5: 16px; --r6: 20px;

    --sh-1: 0 4px 14px rgba(27,43,75,.06);
    --sh-2: 0 10px 30px rgba(27,43,75,.07);
    --sh-float: 0 18px 40px -14px rgba(15,23,42,.28), 0 6px 14px -6px rgba(15,23,42,.14);
    --tr: .18s cubic-bezier(.4,0,.2,1);
    --side-w: 218px;
    --wrap-max: 1560px;
  }

  /* ---------- dark theme (applied via data-theme on <html> by JS) ---------- */
  :global(:root[data-theme="dark"]) {
    --bg: #0f141c; --card: #171e29; --soft: #1b2431;
    --line: #2a3546; --line-2: #232d3c; --line-3: #202a38;
    --ink: #eaf0f8; --ink-2: #c2cede; --muted: #8a98ae; --muted-2: #62708a;
    --brand: #5b8cff; --brand-600: #89abff; --brand-tint: #1a2440;
    --ok: #34d17a; --ok-600: #57e08f; --ok-tint: #15271d; --danger: #f87171;
    --sh-1: 0 1px 2px rgba(0,0,0,.4);
    --sh-2: 0 6px 16px -6px rgba(0,0,0,.5), 0 2px 6px -2px rgba(0,0,0,.4);
    --sh-float: 0 18px 40px -14px rgba(0,0,0,.6), 0 6px 14px -6px rgba(0,0,0,.5);
  }

  /* Overview v2 styles are defined in the approved prototype layout block below. */
  .saved-tag { font-size: 12px; font-weight: 700; color: var(--ok-600, #16a34a); white-space: nowrap; align-self: center; }
  .autosave { font-size: 11.5px; font-weight: 500; color: var(--muted-2); margin-left: 6px; }
  .mode-seg.sm { height: 30px; align-self: center; } .mode-seg.sm button { font-size: 12px; padding: 0 10px; }
  .sel { border: 1px solid var(--line); background: var(--soft); color: var(--ink-2); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer; }
  .mode-explain { font-size: 13px; color: var(--ink-2); background: var(--soft); border: 1px solid var(--line-2); border-radius: 10px; padding: 11px 14px; line-height: 1.55; margin-top: 4px; }
  .mode-explain b { color: var(--brand-600); }
  .mode-explain.warn { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.4); color: var(--ink); }
  .mode-explain.warn b { color: #b45309; }
  .mx-tag { display: inline-block; margin-left: 6px; font-size: 11px; font-weight: 700; color: var(--ok-600); background: var(--ok-tint); padding: 1px 8px; border-radius: 6px; }
  .opt-tag { font-size: 10.5px; font-weight: 700; color: var(--muted); background: var(--surface-3, #eef2f8); padding: 1px 7px; border-radius: 6px; vertical-align: middle; margin-left: 4px; }

  /* prominent warning banner */
  .warnbar { display: flex; align-items: center; gap: 12px; padding: 12px 22px; background: var(--bad-bg, #fdecec); border-bottom: 2px solid var(--danger); color: var(--danger); font-size: 13.5px; flex: none; }
  .warnbar-ic { font-size: 18px; flex: none; }
  .warnbar-txt { flex: 1; line-height: 1.45; } .warnbar-txt strong { font-weight: 780; }
  .warnbar-x { background: none; border: none; color: var(--danger); cursor: pointer; font-size: 15px; opacity: .7; padding: 4px; flex: none; }
  .warnbar-x:hover { opacity: 1; }

  .updatebar { display: flex; align-items: center; gap: 12px; padding: 11px 22px; background: linear-gradient(90deg, var(--brand-tint), var(--card)); border-bottom: 1px solid rgba(40,100,232,.22); color: var(--ink); flex: none; }
  .updatebar.mandatory { background: linear-gradient(90deg, #fff1f2, var(--card)); border-bottom-color: rgba(225,83,97,.3); }
  .updatebar-icon { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: #fff; background: var(--brand); font-weight: 900; }
  .updatebar > div { flex: 1; min-width: 0; }
  .updatebar strong { display: block; font-size: 13px; }
  .updatebar small { display: block; color: var(--muted); margin-top: 2px; font-size: 11.5px; }
  .updatebar button { height: 32px; border: 0; border-radius: 9px; padding: 0 14px; color: #fff; background: var(--brand); font: inherit; font-size: 12px; font-weight: 750; cursor: pointer; }
  .updatebar button:disabled { opacity: .65; cursor: wait; }
  /* 登录/闸机页里的更新条改成卡片样式，与该页留白协调 */
  .gate-updatebar { margin: 0 0 16px; border: 1px solid rgba(40,100,232,.22); border-radius: 12px; }
  /* 强制升级全屏遮罩：覆盖一切、不可关闭 */
  .update-force-mask { position: fixed; inset: 0; z-index: 400; display: grid; place-items: center; padding: 24px; background: rgba(6,12,24,.72); backdrop-filter: blur(4px); }
  .update-force { width: min(440px, 92vw); padding: 26px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); color: var(--ink); box-shadow: 0 30px 90px rgba(0,0,0,.4); text-align: center; }
  .update-force .uf-badge { display: inline-block; margin-bottom: 12px; padding: 3px 12px; border-radius: 999px; background: #fee2e2; color: #dc2626; font-size: 12px; font-weight: 800; }
  .update-force h2 { margin: 0 0 10px; font-size: 20px; }
  .update-force p { margin: 0 0 20px; color: var(--muted); font-size: 13px; line-height: 1.7; }
  .update-force .primary { width: 100%; min-height: 42px; justify-content: center; font-size: 14px; }

  /* capture badge + line health */
  .cap-badge { font-size: 12px; font-weight: 700; padding: 3px 11px; border-radius: 999px; white-space: nowrap; }
  .cap-badge.ok { color: var(--ok-600); background: var(--ok-tint); }
  .cap-badge.bad { color: var(--danger); background: var(--bad-bg, #fdecec); }
  .cap-badge.wait { color: var(--warn); background: var(--warn-bg, #fdf3e3); }
  .cap-badge.idle { color: var(--muted); background: var(--surface-3, #eef2f8); }
  .lh-head, .lh-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) minmax(0, 1.4fr) 74px; gap: 10px; align-items: center; }
  .lh-head { font-size: 11px; color: var(--muted-2); font-weight: 600; padding: 0 2px 8px; border-bottom: 1px solid var(--line-2); }
  .lh-head .r { text-align: right; }
  .lh-row { padding: 9px 2px; border-bottom: 1px solid var(--line-3); font-size: 13px; }
  .lh-row:last-child { border-bottom: none; }
  .lh-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted-2); justify-self: center; }
  .lh-dot.ok { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-tint); }
  .lh-dot.bad { background: var(--danger); box-shadow: 0 0 0 3px var(--bad-bg, #fdecec); }
  .lh-name { font-weight: 620; color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lh-node { color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lh-lat { font-variant-numeric: tabular-nums; font-weight: 650; color: var(--ink-2); }
  .lh-lat.r { text-align: right; } .lh-lat.err { color: var(--danger); }

  /* rule-set (规则库) list */
.rs-head, .rs-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) 58px 150px; gap: 12px; align-items: center; }
  .rs-head { font-size: 11px; color: var(--muted-2); font-weight: 600; padding: 0 2px 10px; border-bottom: 1px solid var(--line-2); }
  .rs-head .r { text-align: right; }
  .rs-row { padding: 12px 2px; border-bottom: 1px solid var(--line-3); }
  .rs-row.disabled .rs-meta, .rs-row.disabled .rs-info { opacity: .52; }
  .rs-row:last-of-type { border-bottom: none; }
  .rs-meta strong { font-size: 13.5px; color: var(--ink); font-weight: 640; } .rs-meta small { display: block; font-size: 12px; color: var(--muted); margin-top: 1px; }
  .rs-info.r { text-align: right; } .rs-info b { font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; } .rs-info small { display: block; font-size: 11.5px; color: var(--muted-2); }
  .rs-miss { color: var(--danger); font-weight: 650; font-size: 12.5px; }
  .rs-note { margin: 14px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.55; background: var(--soft); border: 1px solid var(--line-2); border-radius: 10px; padding: 11px 14px; }
  .rs-note b { color: var(--brand-600); }

  /* custom-rules editor */
  .cr-head, .cr-row { display: grid; grid-template-columns: 132px minmax(0, 1fr) 110px 34px; gap: 10px; align-items: center; }
  .cr-head { font-size: 11px; color: var(--muted-2); font-weight: 600; padding: 2px 2px 8px; }
  .cr-row { padding: 6px 0; }
  .cr-row select, .cr-row input { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--line); background: var(--soft); color: var(--ink); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
  .cr-row select:focus, .cr-row input:focus { outline: none; border-color: var(--brand); }

  /* per-app: running dot + test button + file picker */
  .run-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--muted-2); vertical-align: middle; margin-left: 2px; }
  .run-dot.on { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-tint); }
  .row-actions.ctr { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .mini.test { min-width: 52px; padding: 7px 8px; font-variant-numeric: tabular-nums; background: var(--surface-3, #eef2f8); color: var(--muted); }
  .mini.test.ok { background: var(--ok-tint); color: var(--ok-600); }
  .mini.test.err { background: var(--bad-bg, #fdecec); color: var(--danger); }
  /* Per-node 测TCP / 测Google / 测速度 — one visually-grouped segmented control. */
  .test-group { display: inline-flex; gap: 0; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--line-2); }
  .test-group .mini.test { min-width: 0; border-radius: 0; padding: 7px 9px; font-size: 12px; font-weight: 650; box-shadow: none; }
  .test-group .mini.test + .mini.test { border-left: 1px solid var(--line-2); }
  .test-group .mini.test.tcp { color: #b45309; background: #fff7ed; }
  .test-group .mini.test.tcp:hover:not(:disabled) { background: #ffedd5; }
  .test-group .mini.test:not(.tcp):not(.spd) { color: var(--brand-600); background: var(--brand-tint); }
  .test-group .mini.test:not(.tcp):not(.spd):hover:not(:disabled) { background: #e0e7ff; }
  .test-group .mini.test.spd { color: var(--ok-600); background: var(--ok-tint); }
  .test-group .mini.test.spd:hover:not(:disabled) { filter: brightness(.97); }
  .test-group .mini.test:disabled { opacity: .55; }
  .mini.pick { background: var(--brand-tint); color: var(--brand-600); }
  .mini.pick :global(svg) { width: 14px; height: 14px; }
  .pick-hint { margin: 8px 2px 0; font-size: 11.5px; color: var(--muted-2); }
  .cfg-io { display: inline-flex; gap: 6px; }
  .cfg-io :global(svg) { width: 13px; height: 13px; }

  /* LAN-share sub-form */
  .lan-cfg { padding: 12px 0 6px; border-bottom: 1px solid var(--line-3); display: grid; gap: 10px; min-width: 0; }
  .lan-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  /* 端口只需容纳数字，让「类型」下拉获得更多宽度，避免「混合 (SOCKS5+HTTP)」被截断 */
  .lan-cfg .lan-row:first-child { grid-template-columns: 92px minmax(0, 1fr); }
  .lan-field { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--muted); font-weight: 600; min-width: 0; }
  .lan-field input, .lan-field select { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--line); background: var(--soft); color: var(--ink); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
  .lan-field input:focus, .lan-field select:focus { outline: none; border-color: var(--brand); }
  .lan-hint { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; }
  .lan-hint b { color: var(--brand-600); font-variant-numeric: tabular-nums; }
  @media (max-width: 900px) { .ov-grid { grid-template-columns: 1fr; } .ov-stats { grid-template-columns: repeat(2, 1fr); } .mode-choice { grid-template-columns: 1fr; } }

  :global(*) { box-sizing: border-box; }
  :global(html, body, #app) { margin: 0; width: 100%; height: 100%; }
  :global(body) { overflow: hidden; background: var(--bg); color: var(--ink);
    font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  button, input, textarea, select { font: inherit; color: inherit; }
  button { border: 0; cursor: pointer; background: none; transition: background var(--tr), color var(--tr), box-shadow var(--tr), transform var(--tr), border-color var(--tr); }
  button:disabled { cursor: default; opacity: .55; }
  :global(:focus-visible) { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 6px; }
  i { font-style: normal; display: inline-flex; }
  i :global(svg), .mi :global(svg), button :global(svg) { width: 1em; height: 1em; }

  .shell { height: 100vh; display: grid; grid-template-columns: var(--side-w) 1fr; background: var(--bg); }

  /* ---------- sidebar ---------- */
  .sidebar { background: var(--card); border-right: 1px solid var(--line); padding: 18px 14px 14px; display: flex; flex-direction: column; min-width: 0; }
  .brand { height: 56px; display: flex; align-items: center; gap: 11px; padding: 0 10px 12px; }
  .logo { width: 38px; height: 38px; flex: 0 0 38px; filter: drop-shadow(0 8px 12px rgba(31,83,190,.24)); }
  .logo img { display: block; width: 100%; height: 100%; }
  .brand-title { font-size: 20px; font-weight: 800; color: var(--ink); letter-spacing: -.35px; }
  .brand-title small { display: block; color: var(--muted-2); font-size: 8px; font-weight: 750; letter-spacing: 1.05px; margin-top: 1px; }
  .nav-label { padding: 18px 12px 7px; color: #a0aabd; font-size: 10px; font-weight: 800; letter-spacing: 1.2px; }
  .side-nav { display: grid; gap: 4px; }
  .side-nav button { height: 43px; border-radius: 11px; padding: 0 13px; display: flex; align-items: center; gap: 12px; color: #66748a; font-size: 14px; font-weight: 650; }
  .side-nav button i { font-size: 20px; color: var(--muted-2); transition: color var(--tr); }
  .side-nav button span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .side-nav button:hover { background: var(--line-3); color: var(--ink-2); }
  .side-nav button.active { background: var(--brand-tint); color: var(--brand); font-weight: 650; }
  .side-nav button.active i { color: var(--brand); }
  .sidebar-foot { margin-top: auto; display: grid; gap: var(--s4); }
  .contact-card { display: grid; gap: 6px; padding: 9px; border: 1px solid rgba(255,255,255,.09); border-radius: 11px; background: rgba(255,255,255,.03); }
  .contact-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; color: #cfe0f5; font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
  .contact-row:hover { background: rgba(59,130,246,.16); }
  .contact-row i { display: inline-flex; width: 16px; height: 16px; flex: none; color: #7aa2ff; }
  .contact-row i :global(svg) { width: 16px; height: 16px; }
  .contact-row span { flex: 1; color: #9fb0c7; }
  .contact-row b { color: #eaf1ff; font-weight: 700; letter-spacing: .02em; }
  .contact-row em { flex: none; font-style: normal; font-size: 10px; color: #6b8bc4; }
  .core-card { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border: 1px solid var(--line); border-radius: var(--r3); background: var(--soft); min-width: 0; }
  .core-card strong { display: block; font-size: 13px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .core-card small { display: block; font-size: 11px; color: var(--muted-2); margin-top: 2px; }
  .dot { width: 9px; height: 9px; flex: none; border-radius: 50%; background: #cbd5e1; transition: background var(--tr), box-shadow var(--tr); }
  .dot.on { background: var(--ok); box-shadow: 0 0 0 4px rgba(34,197,94,.14); }
  .foot-icons { display: flex; gap: 8px; }
  .foot-icons button { width: 34px; height: 34px; border-radius: 9px; color: var(--muted-2); font-size: 18px; display: grid; place-items: center; }
  .foot-icons button:hover { background: var(--line-3); color: var(--ink-2); }

  /* 窄窗口优先保留标题、活动节点和启动按钮，统计项不再把顶栏挤出窗口。 */
  @media (max-width: 1480px) {
    .top-metrics .account-chip { display: none; }
    .tb-left { gap: 10px; }.page-identity { min-width: 106px; }
  }
  @media (max-width: 1240px) {
    .top-metrics { display: flex; }
    .top-metrics .metric-status { display: none; }
    .tb-field select { max-width: 160px; }
    .page-identity { display: none; }
  }

  /* ---------- workspace ---------- */
  .workspace { min-width: 0; width: 100%; overflow: hidden; display: flex; flex-direction: column; height: 100vh; }
  .topbar { min-height: 72px; flex: none; min-width: 0; overflow: hidden; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: nowrap;
    padding: 0 24px; background: color-mix(in srgb, var(--card) 96%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
  .tb-left { display: flex; flex: 1 1 auto; align-items: center; gap: 14px; min-width: 0; overflow: hidden; }
  .page-identity { min-width: 128px; }
  .page-identity strong { display: block; font-size: 16px; font-weight: 800; color: var(--ink); }
  .page-identity small { display: block; color: var(--muted-2); font-size: 9px; margin-top: 3px; white-space: nowrap; }
  .top-divider { width: 1px; height: 30px; background: var(--line); flex: none; }
  .tb-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .tb-label { font-size: 11px; color: var(--muted-2); display: flex; align-items: center; gap: 5px; font-weight: 600; letter-spacing: .01em; }
  .node-dot { width: 7px; height: 7px; border-radius: 50%; background: #cbd5e1; transition: background var(--tr); }
  .node-dot.on { background: var(--ok); }
  .tb-field select { height: 34px; max-width: 240px; border: 1px solid var(--line); border-radius: 9px; background: var(--soft); padding: 0 28px 0 12px; font-size: 13px; font-weight: 600; color: var(--ink-2);
    appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 9px center; transition: border-color var(--tr), box-shadow var(--tr); }
  .tb-field select:hover { border-color: var(--muted-2); }
  .route-chip { align-self: flex-end; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px; border-radius: 999px; font-size: 12.5px; font-weight: 650;
    background: #f1f5f9; color: var(--muted); border: 1px solid var(--line); }
  .route-chip .rc-dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; transition: background var(--tr); }
  .route-chip:hover { border-color: #cbd5e1; }
  .route-chip.on { background: var(--ok-tint); color: var(--ok-600); border-color: #bbf7d0; }
  .route-chip.on .rc-dot { background: var(--ok); box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
  .route-chip.sys.on { background: var(--brand-tint); color: var(--brand-600); border-color: #bfdbfe; }
  .route-chip.sys.on .rc-dot { background: var(--brand); box-shadow: 0 0 0 3px rgba(37,99,235,.18); }

  /* 一键切模式 segmented control */
  .mode-seg { align-self: flex-end; display: inline-flex; height: 34px; padding: 3px; gap: 2px; background: #f1f5f9; border: 1px solid var(--line); border-radius: 999px; }
  .mode-seg button { padding: 0 12px; border-radius: 999px; font-size: 12.5px; font-weight: 650; color: var(--muted); background: transparent; border: none; cursor: pointer; white-space: nowrap; transition: all var(--tr); }
  .mode-seg button:hover { color: var(--ink-2); }
  .mode-seg button.on { background: var(--card); color: var(--brand-600); box-shadow: 0 1px 2px rgba(15,23,42,.12); }

  .speed-msg { align-self: center; font-size: 12.5px; font-weight: 600; color: var(--ok-600); }
  .speed-msg.err { color: #dc2626; }

  .tb-right { display: flex; flex: 0 1 auto; min-width: 0; align-items: center; gap: var(--s3) var(--s4); flex-wrap: nowrap; justify-content: flex-end; overflow: hidden; }
  .power-btn { display: flex; align-items: center; gap: 7px; height: 40px; padding: 0 18px; border-radius: var(--r2); font-weight: 750; font-size: 14px;
    color: #fff; background: var(--ok); box-shadow: 0 8px 18px -6px rgba(34,197,94,.5); }
  .power-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 22px -8px rgba(34,197,94,.55); }
  .power-btn:active { transform: translateY(0); }
  .power-btn :global(svg) { width: 18px; height: 18px; }
  .power-btn:not(.running) { background: var(--brand); box-shadow: 0 8px 18px -6px rgba(37,99,235,.5); }
  .power-btn:not(.running):hover { box-shadow: 0 12px 22px -8px rgba(37,99,235,.55); }

  /* ---------- scroll area + columns ---------- */
.scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 22px 24px 26px; }
  .wrap { max-width: var(--wrap-max); margin: 0 auto; display: grid; gap: var(--s5); }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--s5); align-items: start; }
  .col-main { display: grid; gap: var(--s5); min-width: 0; }
  .col-rail { display: grid; gap: var(--s5); min-width: 0; }

  .card { background: var(--card); border: 1px solid var(--line); border-radius: 15px; padding: var(--s5); box-shadow: var(--sh-1); transition: box-shadow var(--tr), border-color var(--tr); }
  .card:hover { box-shadow: var(--sh-2); }

  .hero { display: flex; gap: var(--s5); }
  .hero-icon { width: 52px; height: 52px; flex: none; border-radius: var(--r4); display: grid; place-items: center; font-size: 26px; color: var(--brand); background: var(--brand-tint); }
  .hero-icon :global(svg) { width: 26px; height: 26px; }
  .hero-text { flex: 1; min-width: 0; }
  .hero-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
  .hero-head h2 { margin: 0; font-size: 20px; font-weight: 800; color: var(--ink); letter-spacing: -.01em; }
  .help { display: inline-flex; align-items: center; gap: 5px; color: var(--brand); font-size: 13px; cursor: pointer; }
  .help :global(svg) { width: 15px; height: 15px; }
  .hero-text p { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
  .hero-note { margin-top: 12px; padding: 10px 12px; border-radius: var(--r2); background: #fff7ed; border: 1px solid #fed7aa; color: #b45309; font-size: 12.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .linkbtn { color: var(--brand); font-weight: 650; font-size: 12.5px; text-decoration: underline; text-underline-offset: 2px; }
  .flow-label { margin-top: var(--s4); font-size: 13px; color: var(--muted); }
  .flow { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .fbox { display: flex; align-items: center; gap: 8px; padding: 11px 15px; border: 1px solid var(--line); border-radius: var(--r3); background: var(--soft); font-size: 13.5px; font-weight: 600; color: var(--ink-2); transition: transform var(--tr), box-shadow var(--tr); }
  .fbox:hover { transform: translateY(-1px); box-shadow: var(--sh-1); }
  .fbox i { font-size: 18px; color: var(--muted); }
  .fbox.active { border-color: #bbf7d0; background: var(--ok-tint); color: var(--ok-600); }
  .fbox.active i { color: var(--ok); }
  .farr { color: #cbd5e1; display: inline-flex; } .farr :global(svg) { width: 18px; height: 18px; }

  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s4); flex-wrap: wrap; }
  .card-head.sm { margin-bottom: 14px; }
  .card-head h3 { margin: 0; font-size: 16px; font-weight: 750; color: var(--ink); letter-spacing: -.005em; }
  .sub { margin: 4px 0 0; font-size: 12.5px; color: var(--muted-2); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .primary, .ghost-btn, .mini, .link, .rail-more, .icon-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 9px; font-size: 13px; white-space: nowrap; }
  .primary { background: var(--brand); color: #fff; padding: 9px 15px; font-weight: 650; box-shadow: 0 6px 14px -6px rgba(37,99,235,.5); }
  .primary:hover { background: var(--brand-600); transform: translateY(-1px); box-shadow: 0 10px 18px -8px rgba(37,99,235,.55); }
  .primary:active { transform: translateY(0); }
  .primary :global(svg), .ghost-btn :global(svg) { width: 15px; height: 15px; }
  .ghost-btn { background: var(--line-3); color: var(--ink-2); padding: 9px 14px; }
  .ghost-btn:hover { background: #e6ebf2; }
  .ghost-btn.danger, .icon-btn.danger { color: var(--danger); }
  .ghost-btn.danger:hover { background: #fef2f2; }
  .link { color: var(--brand); font-size: 13px; padding: 4px 6px; border-radius: 8px; }
  .link:hover { background: var(--brand-tint); }
  .link :global(svg) { width: 14px; height: 14px; }
  .icon-btn { padding: 7px; color: var(--muted-2); }
  .icon-btn :global(svg) { width: 17px; height: 17px; }
  .icon-btn.danger:hover { color: var(--danger); background: #fef2f2; }

  /* ---------- rules table ---------- */
  .tscroll { overflow-x: auto; overflow-y: hidden; margin: 0 calc(var(--s5) * -1); padding: 0 var(--s5); }
  .rtable { display: grid; gap: 2px; min-width: 860px; width: 100%; }
  .rhead, .rrow { display: grid; grid-template-columns: minmax(260px, 1.55fr) minmax(130px, .72fr) minmax(160px, .95fr) 60px 92px; gap: 12px; align-items: center; }
  .node-select { font-weight: 500; }
  .node-select:disabled { opacity: .4; cursor: not-allowed; }
  .rhead { min-height: 40px; padding: 0 10px; font-size: 11.5px; color: var(--muted-2); border-bottom: 1px solid var(--line-2); font-weight: 700; letter-spacing: .02em; }
  .ctr { text-align: center; justify-content: center; }
  .rrow > .switch { justify-self: center; }
  .rrow { min-width: 0; min-height: 62px; padding: 10px; border-bottom: 1px solid var(--line-3); border-radius: 8px; transition: background var(--tr); }
  .rrow:hover { background: var(--soft); }
  .rrow.off { opacity: .55; }
  /* 应用规则目标条件（域名/IP/端口作用域） */
  .scope-badge { margin-left: 6px; font-size: 10px; font-weight: 700; color: var(--brand-600, #2454d4); background: var(--brand-tint, #eef3ff); padding: 1px 6px; border-radius: 999px; vertical-align: middle; }
  .icon-btn.scope-btn.on { color: var(--brand-600, #2454d4); background: var(--brand-tint, #eef3ff); }
  .scope-row { padding: 10px 12px 14px; margin: -2px 0 4px; background: var(--soft); border-radius: 8px; border: 1px dashed var(--line-2); }
  .scope-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .scope-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--muted-2); font-weight: 600; }
  .scope-grid input { height: 32px; border: 1px solid #e2e8f0; border-radius: 8px; background: var(--card); padding: 0 10px; font-size: 12.5px; color: var(--ink-2); }
  .scope-grid input:focus { border-color: var(--brand); outline: none; }
  .scope-hint { margin: 8px 0 0; font-size: 11.5px; color: var(--muted-2); line-height: 1.5; }
  @media (max-width: 900px) { .scope-grid { grid-template-columns: 1fr; } }
  .app-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .app-meta { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .app-icon-placeholder { width: 34px; height: 34px; flex: none; border-radius: 9px; background: var(--soft); border: 1px solid var(--line-2); }
  .app-icon-img { width: 34px; height: 34px; flex: none; padding: 2px; border-radius: 9px; object-fit: contain; background: #fff; border: 1px solid var(--line-2); }
  .app-cell strong { font-size: 14px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .path { font-size: 11.5px; color: var(--muted-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .node-col { font-size: 13px; color: var(--muted); }
  .line-select { width: 100%; min-width: 0; height: 34px; border: 1px solid #e2e8f0; border-radius: 9px; background: var(--soft); padding: 0 28px 0 11px; font-size: 13px; font-weight: 600; color: var(--ink-2);
    appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 9px center; transition: border-color var(--tr), box-shadow var(--tr); }
  .line-select:hover { border-color: #cbd5e1; }
  .empty { padding: 26px; text-align: center; color: var(--muted-2); font-size: 13.5px; line-height: 1.6; }
  .empty.sm { padding: 14px; font-size: 12.5px; }

  .switch { position: relative; width: 40px; height: 22px; display: inline-block; flex: none; }
  .switch input { display: none; }
  .switch i { position: absolute; inset: 0; border-radius: 99px; background: #cbd5e1; transition: background var(--tr); }
  .switch i:before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: transform var(--tr); }
  .switch input:checked + i { background: var(--brand); }
  .switch input:checked + i:before { transform: translateX(18px); }
  .rfoot { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; margin-top: var(--s4); padding-top: var(--s4); border-top: 1px solid var(--line-2); }
  .modes { display: flex; align-items: center; gap: 8px 18px; font-size: 13px; color: var(--muted); flex-wrap: wrap; }
  .modes-k { color: var(--muted-2); font-weight: 600; }
  .dl-field span { color: var(--muted-2); font-weight: 600; }
  .mode-hint { margin: 10px 2px 0; font-size: 12px; color: var(--muted-2); line-height: 1.6; }

  /* ---------- picker ---------- */
  .picker { border: 1px solid var(--line); border-radius: var(--r3); padding: 12px; margin-bottom: 14px; background: var(--soft); }
  .picker > input { width: 100%; }
  .proc-list { display: grid; gap: 6px; max-height: 240px; overflow: auto; margin: 10px 0; }
  .proc-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 8px 10px; background: var(--card); border: 1px solid var(--line); border-radius: 9px; }
  .proc-info { min-width: 0; }
  .proc-info strong { display: block; font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proc-info small { display: block; font-size: 11px; color: var(--muted-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proc-count { font-size: 12px; color: var(--muted-2); white-space: nowrap; }
  .picker-foot { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .picker-foot .mini { min-height: 36px; }
  .mini { background: var(--brand-tint); color: var(--brand); padding: 8px 13px; font-size: 12.5px; font-weight: 600; }
  .mini.danger { background: var(--bad-bg, #fdecec); color: var(--danger); }
  .mini:hover { background: #e0e7ff; }
  .grow { flex: 1 1 180px; min-width: 0; }

  /* ---------- right rail ---------- */
  .nrail-head { display: grid; grid-template-columns: minmax(0, 1fr) 58px 66px 104px; gap: 8px; font-size: 11px; color: var(--muted-2); padding: 0 2px 8px; font-weight: 600; letter-spacing: .02em; }
  .nrail-row { display: grid; grid-template-columns: minmax(0, 1fr) 58px 66px 104px; gap: 8px; align-items: center; padding: 9px 6px; border-radius: 9px; cursor: pointer; transition: background var(--tr); }
  .nrail-row:hover { background: var(--soft); }
  .nrail-row.sel { background: var(--ok-tint); }
  .nrail-name { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); font-weight: 550; min-width: 0; }
  .nrail-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .flag { width: 16px; height: 12px; border-radius: 3px; flex: none; background: #cbd5e1; }
  .flag.jp, .flag.sg, .flag.hk { background: linear-gradient(#fff 50%, #dc2626 50%); }
  .flag.us { background: linear-gradient(#3b82f6, #1d4ed8); } .flag.de { background: linear-gradient(#111 33%, #dc2626 33% 66%, #f59e0b 66%); }
  .active-badge { font-size: 10px; color: var(--ok-600); background: #dcfce7; padding: 1px 6px; border-radius: 5px; font-weight: 700; flex: none; }
  .lat { font-size: 13px; font-weight: 650; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lat[data-q="4"] { color: var(--ok-600); } .lat[data-q="3"] { color: var(--ok); } .lat[data-q="2"] { color: #f59e0b; } .lat[data-q="1"] { color: var(--danger); }
  .lat.tcp { font-size: 12px; font-weight: 550; opacity: .82; }
  .spd { font-size: 12px; color: var(--muted-2); display: flex; align-items: center; gap: 5px; justify-content: flex-end; white-space: nowrap; }
  .spd b { color: var(--ink-2); font-weight: 650; font-variant-numeric: tabular-nums; }
  .bars { display: inline-flex; } .bars :global(svg) { width: 15px; height: 15px; }
  .bars[data-q="4"] { color: var(--ok-600); } .bars[data-q="3"] { color: var(--ok); } .bars[data-q="2"] { color: #f59e0b; } .bars[data-q="1"] { color: var(--danger); }
  .rail-more { width: 100%; justify-content: center; margin-top: 8px; padding: 9px; color: var(--brand); font-size: 13px; border-top: 1px solid var(--line-2); border-radius: 0 0 8px 8px; }
  .rail-more:hover { background: var(--soft); }
  .rail-more :global(svg) { width: 14px; height: 14px; }

  .rlog { display: grid; gap: 9px; }
  .rlog-row { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; }
  .rlog-row .t { color: var(--muted-2); font-variant-numeric: tabular-nums; font-size: 11.5px; flex: none; }
  .rlog-row .lv { font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; flex: none; }
  .lv.INFO { color: var(--brand); background: var(--brand-tint); } .lv.WARN { color: #b45309; background: #fef3c7; } .lv.ERROR { color: #dc2626; background: #fee2e2; }
  .rlog-row .m { color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .foot-link { margin-top: 12px; }

  /* ---------- nodes tab ---------- */
  textarea { width: 100%; min-height: 96px; resize: vertical; border: 1px solid #e2e8f0; border-radius: 11px; padding: 12px; background: var(--soft); font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; outline: none; transition: border-color var(--tr), box-shadow var(--tr); }
  textarea:focus, input:focus { border-color: #93c5fd; box-shadow: 0 0 0 3px rgba(59,130,246,.12); }
  input { border: 1px solid #e2e8f0; border-radius: var(--r2); padding: 9px 12px; background: var(--soft); outline: none; font-size: 13px; transition: border-color var(--tr), box-shadow var(--tr); }
  .toast { color: var(--ok-600); font-size: 13px; margin-top: 8px; }
  /* 表头和每一行必须共用同一组父级轨道。之前每行各算一次 `auto`
     操作列，表头的“操作”很窄、数据行按钮很宽，导致四列整体错位。 */
  .ntable { display: grid; grid-template-columns: minmax(0, 2fr) minmax(96px, .5fr) minmax(110px, .6fr) 120px auto; gap: 2px 12px; min-width: 560px; }
  .nhead, .nrow { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; column-gap: 12px; align-items: center; }
  .nhead { font-size: 11.5px; color: var(--muted-2); padding: 0 8px 10px; border-bottom: 1px solid var(--line-2); font-weight: 600; letter-spacing: .02em; }
  .nhead > span:not(.ctr) { justify-self: start; text-align: left; }
  .nrow { padding: 11px 8px; border-bottom: 1px solid var(--line-3); border-radius: 8px; transition: background var(--tr); cursor: pointer; }
  .nrow:hover { background: var(--soft); }
  .nrow.sel { background: var(--ok-tint); }
  .ncell { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .nmeta { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .nmeta strong { font-size: 14px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { flex: none; width: max-content; text-transform: uppercase; font-size: 10.5px; font-weight: 800; color: var(--brand); background: var(--brand-tint); border-radius: 6px; padding: 3px 8px; letter-spacing: .03em; }
  .muted { color: var(--muted-2); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nspd { font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .row-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }

  /* ---------- subs ---------- */
  .page { min-height: 300px; }
  .sub-list { display: grid; gap: 8px; }
  .sub-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 8px 14px; align-items: center; padding: 12px 14px; border: 1px solid var(--line); border-radius: 11px; transition: border-color var(--tr), box-shadow var(--tr); }
  .sub-row:hover { border-color: #d7dee8; box-shadow: var(--sh-1); }
  .sub-meta { min-width: 0; }
  .sub-edit-fields { display: grid; gap: 9px; width: 100%; }
  .sub-edit-fields label { display: grid; gap: 5px; color: var(--muted); font-size: 11.5px; font-weight: 700; }
  .sub-edit-fields input { width: 100%; min-height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--ink); outline: none; }
  .sub-edit-fields input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-tint); }
  .sub-row strong { font-size: 14px; color: var(--ink); } .sub-row small { display: block; font-size: 12px; color: var(--muted-2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub-count { font-size: 13px; color: var(--muted); white-space: nowrap; }

  /* ---------- settings / routing ---------- */
  .route-card { margin-bottom: 0; }
  .route-top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s4); flex-wrap: wrap; margin-bottom: var(--s4); }
  .route-title { min-width: 0; }
  .route-title h3 { margin: 0; font-size: 16px; font-weight: 750; color: var(--ink); }
  .route-master { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--r3); background: var(--soft); transition: border-color var(--tr), background var(--tr); }
  .route-master.on { border-color: #bbf7d0; background: var(--ok-tint); }
  .rm-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .route-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: var(--s4); }
  .rs-msg { font-size: 12.5px; font-weight: 650; color: var(--ok-600); }
  .rs-msg.err { color: var(--danger); }
  .rs-hint { font-size: 12px; color: var(--muted-2); }
  .route-rules { display: grid; gap: 8px; margin-top: 14px; }
  .route-rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .route-rule select { flex: 0 1 auto; min-width: 118px; border: 1px solid #e2e8f0; border-radius: 9px; padding: 8px 10px; background: var(--soft); font-size: 13px; color: var(--ink-2); }
  .route-rule input { flex: 1 1 200px; min-width: 0; padding: 8px 11px; }

  /* ---------- approved UI prototype v2 layout ---------- */
  .nav-count { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; display: grid; place-items: center; border-radius: 10px; background: var(--brand); color: #fff; font-size: 10px; font-style: normal; }
  .top-metrics { gap: 20px; flex-wrap: nowrap; }
  .metric-mini { min-width: 72px; white-space: nowrap; }
  .metric-mini small { display: block; margin-bottom: 2px; color: var(--muted-2); font-size: 9px; }
  .metric-mini strong { color: var(--ink); font-size: 13px; font-variant-numeric: tabular-nums; }
  .metric-mini .down { color: var(--brand); } .metric-mini .up { color: var(--ok); }
  .page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: -3px; }
  .page-head h1 { margin: 0; color: var(--ink); font-size: 22px; font-weight: 820; letter-spacing: -.45px; }
  .page-head p { margin: 6px 0 0; color: var(--muted-2); font-size: 12px; }
  .head-actions { display: flex; gap: 9px; flex-wrap: wrap; }
  .btn { min-height: 36px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid #d9e1ec; border-radius: 9px; background: var(--card); color: var(--ink-2); font-size: 13px; font-weight: 700; }
  .btn:hover { border-color: #b7c6dc; background: var(--soft); }
  .btn.primary { border-color: var(--brand); background: var(--brand); color: #fff; box-shadow: 0 5px 13px rgba(40,100,232,.18); }
  .btn.sm { min-height: 30px; padding: 0 10px; border-radius: 8px; font-size: 12px; }
  .btn.grow { flex: 1; }

  .grid { display: grid; gap: 16px; }
  .grid.kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .grid.main-grid { grid-template-columns: minmax(0, 1.75fr) minmax(300px, .8fr); align-items: start; }
  .grid.kpis > .card, .grid.main-grid .card { padding: 0; overflow: hidden; }
  .kpi { min-height: 82px; padding: 15px 16px !important; display: flex; align-items: center; gap: 13px; }
  .kpi-icon { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border-radius: 12px; background: var(--brand-tint); color: var(--brand); font-size: 20px; }
  .kpi-icon.green { background: var(--ok-tint); color: var(--ok); } .kpi-icon.orange { background: #fff6e8; color: #df8a19; }
  .kpi-label { color: var(--muted-2); font-size: 10px; font-weight: 700; }
  .kpi-value { max-width: 220px; margin-top: 3px; color: var(--ink); font-size: 20px; font-weight: 850; letter-spacing: -.3px; }
  .kpi-value.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kpi-value small { margin-left: 3px; color: var(--muted-2); font-size: 10px; font-weight: 650; }
  .grid.main-grid .card-head, .node-manager-v2 .card-head, .apps-v2 .card-head, .page.card > .card-head { min-height: 55px; margin: 0; padding: 14px 17px; align-items: center; border-bottom: 1px solid var(--line); }
  .card-title { color: var(--ink); font-size: 14px; font-weight: 800; }
  .card-sub { margin-top: 3px; color: var(--muted-2); font-size: 11px; }
  .card-body { padding: 17px; }
  .route-flow { padding: 20px 18px; display: grid; grid-template-columns: repeat(4, 1fr); align-items: center; gap: 20px; }
  .flow-step { position: relative; min-width: 0; text-align: center; }
  .flow-step:not(:last-child)::after { content: ''; position: absolute; top: 21px; right: -22px; width: 24px; height: 1px; background: #ccd6e5; }
  .flow-node { width: 44px; height: 44px; margin: 0 auto 8px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 12px; background: var(--soft); color: var(--muted); font-size: 20px; }
  .flow-step.active .flow-node { border-color: #d9e5ff; background: var(--brand-tint); color: var(--brand); }
  .flow-step.good .flow-node { border-color: #d4f0e1; background: var(--ok-tint); color: var(--ok); }
  .flow-step b { display: block; color: var(--ink); font-size: 12px; } .flow-step small { color: var(--muted-2); font-size: 9px; }
  .status-pill { min-height: 23px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 12px; background: var(--ok-tint); color: var(--ok-600); font-size: 10px; font-weight: 800; white-space: nowrap; }
  .status-pill.gray { background: #f0f3f7; color: #748197; }
  .quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .quick { min-height: 76px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--card); text-align: left; }
  .quick:hover { border-color: #c9d7ed; transform: translateY(-1px); box-shadow: var(--sh-1); }
  .quick b { display: block; margin-bottom: 4px; color: var(--ink); } .quick small { color: var(--muted-2); font-size: 10px; }
  .health-list { display: grid; gap: 11px; }
  .health-item { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; text-align: left; }
  .health-info b { color: var(--ink); font-size: 12px; } .health-info small { display: block; margin-top: 3px; color: var(--muted-2); font-size: 9px; }
  .health-bar { height: 5px; margin-top: 7px; overflow: hidden; border-radius: 4px; background: #edf1f6; }
  .health-bar i { display: block; height: 100%; border-radius: inherit; background: var(--ok); }
  .latency { color: var(--ok-600); font-size: 11px; font-weight: 800; }
  .table-wrap { overflow: hidden; }
  .table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .table th { height: 39px; padding: 0 13px; border-bottom: 1px solid var(--line); background: var(--soft); color: var(--muted-2); text-align: left; font-size: 10px; font-weight: 800; }
  .table td { height: 58px; padding: 0 13px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); vertical-align: middle; text-align: left; font-size: 12px; }
  .table tr:last-child td { border-bottom: 0; }
  .app-traffic-table .app-col { width: 46%; }
  .app-traffic-table .policy-col { width: 15%; }
  .app-traffic-table .node-col-width { width: 23%; }
  .app-traffic-table .state-col { width: 16%; }
  .app-traffic-table th, .app-traffic-table td { box-sizing: border-box; }
  .entity { width: 100%; display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; justify-items: start; gap: 10px; min-width: 0; text-align: left; }
  .entity-icon { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 9px; background: var(--brand-tint); color: var(--brand); font-size: 10px; font-weight: 900; }
  .entity-icon.app { background: linear-gradient(145deg, #4c7ff1, #285ed9); color: #fff; }
  .entity-icon.real-app-icon { overflow: hidden; border: 1px solid var(--line); background: var(--card); }
  .entity-icon.real-app-icon img { width: 27px; height: 27px; display: block; object-fit: contain; }
  .entity-text { width: 100%; min-width: 0; text-align: left; } .entity-text b, .entity-text small { display: block; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .entity-text b { color: var(--ink); font-size: 12px; } .entity-text small { margin-top: 3px; color: var(--muted-2); font-size: 9px; }
  .tag { min-height: 22px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 6px; background: var(--brand-tint); color: var(--brand); font-size: 9px; font-weight: 850; }

  .summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; overflow: hidden; margin-bottom: -4px; border: 1px solid var(--line); border-radius: 13px; background: var(--line); }
  .summary-cell { min-height: 66px; padding: 13px 15px; background: var(--card); }
  .summary-cell > span { display: block; color: var(--muted-2); font-size: 10px; }
  .summary-cell > b { display: block; max-width: 240px; margin-top: 5px; overflow: hidden; color: var(--ink); font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
  .summary-cell > b.good { color: var(--ok-600); }
  .summary-mode { display: flex; gap: 4px; margin-top: 5px; }
  .summary-mode button { padding: 4px 8px; border-radius: 7px; color: var(--muted); font-size: 11px; font-weight: 700; }
  .summary-mode button.active { background: var(--brand-tint); color: var(--brand); }
  .apps-v2 { display: block; }
  .apps-v2 .col-main { display: block; }
  .apps-v2 .hero, .apps-v2 .col-main > section:nth-child(2), .apps-v2 .col-rail { display: none; }
  .apps-v2 .col-main > section.card { padding: 0; overflow: hidden; }
  .apps-v2 .col-main > section.card > .card-head { flex-wrap: nowrap; }
  .apps-v2 .tscroll { margin: 0; padding: 0 17px; max-width: 100%; }
  .apps-v2 .rhead { min-height: 42px; padding: 0 10px; background: var(--soft); }
  .apps-v2 .rrow { min-height: 58px; border-radius: 0; }
  .apps-v2 .rfoot { margin: 0; padding: 13px 17px; border-top: 1px solid var(--line); }

  .node-manager-v2 { display: grid; grid-template-columns: minmax(310px, .72fr) minmax(0, 1.65fr); gap: 16px; align-items: start; }
  .node-manager-v2 > .card { padding: 0; overflow: hidden; }
  .node-import-body { padding: 17px; }
  .node-import-body .hint { margin-top: 8px; }
  .tabs { display: flex; gap: 3px; padding: 4px; border-radius: 10px; background: #f1f4f8; }
  .tabs button { height: 31px; flex: 1; border-radius: 8px; color: #6c798f; font-size: 12px; font-weight: 700; }
  .tabs button.active { background: var(--card); color: var(--brand); box-shadow: 0 2px 8px rgba(30,47,75,.08); }
  .field-label { display: block; margin: 15px 0 7px; color: #67748a; font-size: 11px; font-weight: 750; }
  .textarea { width: 100%; min-height: 150px; padding: 10px 11px; resize: vertical; border: 1px solid #d9e1ec; border-radius: 9px; background: var(--card); line-height: 1.6; outline: none; }
  .textarea:focus { border-color: #8cacf5; box-shadow: 0 0 0 3px rgba(40,100,232,.09); }
  .form-actions { display: flex; gap: 8px; margin-top: 13px; }
  .searchbar { width: min(290px, 34vw); min-height: 37px; padding: 0 11px; display: flex; align-items: center; gap: 8px; border: 1px solid #d9e1ec; border-radius: 9px; background: var(--card); }
  .searchbar input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; }
  .node-list-card .tscroll { margin: 0; padding: 0 17px; }
  .node-list-card .nhead { min-height: 39px; padding: 0 8px; background: var(--soft); }
  .node-list-card .nrow { min-height: 58px; border-radius: 0; }
  .node-list-foot { padding: 13px 17px; border-top: 1px solid var(--line); }
  .manual-form { margin: 14px 0 0; }

  .rules-library-v2, .custom-rules-v2, .subs-page-v2 { padding: 0; overflow: hidden; }
  .rules-library-v2 .rs-list, .custom-rules-v2 .cr-list { padding: 0 17px 14px; }
  .rules-library-v2 > .setting, .rules-library-v2 > .rs-note { margin: 0 17px 14px; }
  .route-card { padding: 20px; }
  .subs-page-v2 > .card-head { display: none; }
  .subs-page-v2 .picker { margin: 17px; }
  .subs-page-v2 .sub-list { padding: 17px; display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; }
  .subs-page-v2 .sub-row { min-height: 145px; padding: 17px; display: flex; flex-direction: column; align-items: stretch; border: 1px solid var(--line); border-radius: 13px; box-shadow: var(--sh-1); }
  .subs-page-v2 .sub-row.editing { min-height: 225px; border-color: var(--brand); }
  .subs-page-v2 .sub-meta { width: 100%; } .subs-page-v2 .sub-count { margin-top: 12px; color: var(--brand); font-weight: 750; }
  .subs-page-v2 .row-actions { width: 100%; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); }
  .log-full { padding: 0; overflow: hidden; }
  .log-full .card-head { margin: 0; padding: 14px 17px; border-bottom: 1px solid rgba(255,255,255,.08); background: #182234; }
  .log-full .card-head h3 { color: #d5dbea; } .log-full .card-head .sub { color: #8996aa; }
  .log-full .logbox { margin: 0; min-height: 470px; border: 0; border-radius: 0; }
  .settings-grid > .card { padding: 20px; }

  /* ---------- account / license ---------- */
  .license-login { height: 100vh; overflow-y: auto; display: grid; place-items: center; padding: 28px; background: radial-gradient(circle at 50% -10%, #dbeafe 0, transparent 42%), var(--page); }
  .license-login-card { width: min(390px, 100%); display: grid; gap: 17px; padding: 34px; border: 1px solid var(--line); border-radius: 22px; background: rgba(255, 255, 255, .94); box-shadow: 0 24px 70px rgba(15, 23, 42, .13); }
  .license-mark { width: 54px; height: 54px; display: grid; place-items: center; margin: 0 auto -4px; border-radius: 15px; color: #fff; background: linear-gradient(135deg, var(--brand), #6366f1); box-shadow: 0 10px 24px rgba(37, 99, 235, .27); font-size: 28px; }
  .license-login-title { display: grid; gap: 5px; text-align: center; }
  .license-login-title span { font-size: 24px; font-weight: 850; color: var(--ink); letter-spacing: -.02em; }
  .license-login-title small { font-size: 13px; color: var(--muted); }
  .trial-guide { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; padding: 12px; border: 1px solid #bfdbfe; border-radius: 12px; background: #eff6ff; }
  .trial-guide b { grid-column: 1 / -1; color: #1d4ed8; font-size: 12px; }
  .trial-guide span { display: grid; justify-items: center; gap: 5px; color: #475569; font-size: 10px; line-height: 1.35; text-align: center; }
  .trial-guide i { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 50%; color: #fff; background: #2563eb; font-size: 10px; font-style: normal; font-weight: 800; }
  .license-login-card label { display: grid; gap: 7px; color: var(--ink-2); font-size: 13px; font-weight: 700; }
  .license-login-card input { width: 100%; padding: 12px 13px; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); color: var(--ink); font: inherit; outline: none; }
  .license-login-card input:focus { border-color: var(--brand); background: #fff; box-shadow: 0 0 0 3px var(--brand-tint); }
  .license-submit { width: 100%; min-height: 44px; justify-content: center; }
  .license-error { padding: 9px 11px; border: 1px solid #fecaca; border-radius: 9px; background: #fef2f2; color: #b91c1c; font-size: 12.5px; line-height: 1.5; }
  .license-tip { margin: -3px 0 0; color: var(--muted-2); font-size: 11.5px; line-height: 1.6; text-align: center; }
  .account-chip { display: flex; align-items: center; gap: 8px; max-width: 230px; padding: 5px 10px 5px 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--ink); cursor: pointer; font-family: inherit; }
  .account-chip > span { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border-radius: 8px; background: var(--brand-tint); color: var(--brand-600); font-size: 12px; font-weight: 850; }
  .account-chip div { min-width: 0; display: grid; text-align: left; }
  .account-chip b, .account-chip small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .account-chip b { font-size: 11.5px; } .account-chip small { color: var(--muted-2); font-size: 10px; }
  .account-card { grid-column: 1 / -1; }
  .account-grid { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; }
  .account-grid > div { min-width: 0; display: grid; gap: 4px; padding: 12px; border-radius: 10px; background: var(--soft); }
  .account-grid span { color: var(--muted-2); font-size: 11px; }
  .account-grid b { overflow: hidden; color: var(--ink-2); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .settings-devices { margin-top: 14px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; }
  .settings-devices-head,.settings-device-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 13px; border-bottom: 1px solid var(--line); }
  .settings-devices-head { background: var(--soft); }
  .settings-devices-head>div,.settings-device-row>div:first-child { min-width: 0; display: grid; gap: 3px; }
  .settings-devices-head b,.settings-device-row b { color: var(--ink-2); font-size: 12px; }
  .settings-devices-head small,.settings-device-row small { overflow: hidden; color: var(--muted-2); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .settings-device-row:last-child { border-bottom: 0; }
  .settings-device-row>div:last-child { display: flex; flex: none; align-items: center; gap: 8px; }
  .current-device-light { padding: 4px 7px; border-radius: 999px; color: var(--ok-600); background: var(--ok-tint); font-size: 10px; font-weight: 700; }
  .settings-device-empty { padding: 18px; color: var(--muted-2); font-size: 11px; text-align: center; }
  .settings-device-error { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; color: #a85b08; background: #fff8eb; font-size: 11px; }
  .account-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }

  /* ---------- line manager ---------- */
  .line-list { display: grid; gap: 2px; margin: var(--s4) 0 var(--s3); }
  .line-list-head, .line-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 96px auto; gap: 12px; align-items: center; }
  .line-list-head { padding: 0 6px 10px; font-size: 11.5px; color: var(--muted-2); border-bottom: 1px solid var(--line-2); font-weight: 600; letter-spacing: .02em; }
  .line-row { padding: 11px 6px; border-bottom: 1px solid var(--line-3); border-radius: 8px; transition: background var(--tr); }
  .line-row:hover { background: var(--soft); }
  .line-name { min-width: 0; } .line-name strong { font-size: 14px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line-exit, .line-mode { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line-tools { margin-top: 4px; }
  .line-form { margin-top: var(--s4); padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r3); background: var(--soft); }
  .lf-head { font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 12px; }
  .lf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .lf-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; font-size: 12px; color: var(--muted-2); font-weight: 600; }
  .lf-field input, .lf-field select { min-width: 0; border: 1px solid #e2e8f0; border-radius: 9px; padding: 9px 11px; background: var(--card); font-size: 13px; font-weight: 500; color: var(--ink-2); }
  .lf-foot { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--s4); }
  .ai-card { grid-column: 1 / -1; border: 1.5px solid var(--brand); background: linear-gradient(180deg, rgba(37,99,235,0.05), transparent 60%); }
  .ai-dot { font-size: 12px; font-weight: 700; color: var(--muted-2); white-space: nowrap; }
  .ai-dot.on { color: var(--ok-600, #16a34a); }
  .ai-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .ai-k { width: 68px; flex: none; font-size: 12.5px; color: var(--muted); }
  .ai-v { flex: 1; min-width: 120px; background: var(--soft); border: 1px solid var(--line); border-radius: 7px; padding: 5px 9px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ai-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  .ai-big { font-size: 14px; padding: 10px 18px; }
  .ai-hint { margin-top: 12px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .settings-grid h3 { margin: 0 0 8px; font-size: 15px; color: var(--ink); }
  .setting { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line-3); font-size: 13.5px; color: var(--muted); }
  .setting:last-child { border-bottom: 0; } .setting strong { color: var(--ink); text-align: right; white-space: nowrap; }
  .setting-hint { display: block; color: var(--muted); font-size: 11px; font-weight: 400; margin-top: 2px; }
  .manual-form { margin-top: 10px; padding: 12px; border: 1px solid var(--line-2); border-radius: 12px; background: var(--surface-2); }
  .mf-head { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
  .mf-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .mf-row select, .mf-row input { border: 1px solid var(--line-2); border-radius: 9px; padding: 8px 11px; background: var(--surface); font-size: 13px; color: var(--ink); }
  .mf-row input.grow { flex: 1; min-width: 160px; }
  .mf-port { width: 96px; }
  .toast.err { color: #dc2626; }
  .core-update { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .core-update .mini :global(svg) { width: 14px; height: 14px; }
  .setting .mini :global(svg) { width: 14px; height: 14px; }

  /* ---------- logs ---------- */
  .log-full { min-height: calc(100vh - 180px); display: flex; flex-direction: column; }
  .log-full .actions input { min-width: 0; }
  .logbox { flex: 1; min-height: 360px; background: #0b1120; border: 1px solid #1e293b; border-radius: var(--r3); padding: 8px 6px; overflow: auto; font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: 12.5px; line-height: 1.55; }
  .lg-line { display: flex; align-items: baseline; gap: 9px; padding: 2px 8px; border-radius: 5px; text-align: left; white-space: normal; }
  .lg-line:hover { background: rgba(148, 163, 184, 0.08); }
  .lg-line.error { background: rgba(239, 68, 68, 0.09); }
  .lg-line.warn { background: rgba(245, 158, 11, 0.08); }
  .lg-time { flex: none; color: #64748b; font-variant-numeric: tabular-nums; font-size: 11.5px; letter-spacing: 0.02em; }
  .lg-lv { flex: none; min-width: 46px; text-align: center; font-weight: 800; font-size: 10px; letter-spacing: 0.05em; padding: 1px 5px; border-radius: 4px; }
  .lg-lv.info { color: #38bdf8; background: rgba(56, 189, 248, 0.14); }
  .lg-lv.warn { color: #fbbf24; background: rgba(251, 191, 36, 0.16); }
  .lg-lv.error, .lg-lv.fatal, .lg-lv.panic { color: #f87171; background: rgba(248, 113, 113, 0.18); }
  .lg-lv.debug, .lg-lv.trace { color: #94a3b8; background: rgba(148, 163, 184, 0.14); }
  .lg-tag { flex: none; color: #c084fc; font-weight: 700; font-size: 11.5px; }
  .lg-msg { flex: 1; min-width: 0; color: #d1dae7; word-break: break-word; }
  .lg-line.error .lg-msg { color: #fca5a5; }
  .lg-line.warn .lg-msg { color: #fcd77f; }
  .lg-empty { padding: 16px; text-align: center; color: #64748b; }

  /* ---------- 实时连接诊断表 ---------- */
  .conn-table { max-height: 300px; overflow: auto; }
  .conn-head, .conn-row { display: grid; grid-template-columns: minmax(90px,1fr) minmax(120px,1.4fr) minmax(120px,1.4fr) 96px 118px; gap: 10px; align-items: center; padding: 7px 12px; }
  .conn-head { position: sticky; top: 0; background: var(--card); font-size: 11px; color: var(--muted-2); font-weight: 600; border-bottom: 1px solid var(--line-2); z-index: 1; }
  .conn-row { border-bottom: 1px solid var(--line-3); font-size: 12.5px; }
  .conn-row:hover { background: var(--soft); }
  .conn-head .r, .conn-tx.r { text-align: right; justify-self: end; }
  .conn-proc { font-weight: 600; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .conn-dest, .conn-rule { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink-2); }
  .conn-dest small { margin-left: 6px; font-size: 10px; color: var(--muted-2); text-transform: uppercase; }
  .conn-rule { color: var(--muted); font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
  .conn-out { font-weight: 700; font-size: 12px; padding: 2px 9px; border-radius: 999px; text-align: center; white-space: nowrap; }
  .conn-out[data-o="proxy"] { color: var(--brand-600, #2454d4); background: var(--brand-tint, #eef3ff); }
  .conn-out[data-o="direct"] { color: var(--muted); background: var(--line-3); }
  .conn-out[data-o="block"] { color: var(--danger); background: var(--bad-bg, #fdecec); }
  .conn-tx { font-variant-numeric: tabular-nums; color: var(--muted-2); font-size: 11.5px; white-space: nowrap; }

  /* ---------- bottom status bar ---------- */
  .statusbar { min-height: 40px; flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; padding: 6px 22px; background: var(--card); border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
  .sb-k { color: var(--muted-2); } .sep { color: #cbd5e1; margin: 0 6px; }
  .sb-mode { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); background: var(--surface, var(--card)); color: var(--muted); border-radius: 7px; padding: 3px 9px; font-size: 12.5px; font-family: inherit; cursor: pointer; transition: all var(--tr); }
  .sb-mode:hover { border-color: var(--brand); color: var(--brand-600); }
  .sb-mode :global(svg) { width: 12px; height: 12px; opacity: .6; }
  .sb-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; } .sb-right b { color: var(--ink-2); }
  .sb-right b.on { color: var(--brand-600); }
  .sb-right .mini { padding: 5px 10px; }
  .ok { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: #e2e8f0; color: var(--muted-2); font-size: 12px; }
  .ok.on { background: #dcfce7; color: var(--ok-600); }

  /* ---------- QR share modal ---------- */
  .modal-mask { position: fixed; inset: 0; background: rgba(15,23,42,.5); backdrop-filter: blur(2px); display: grid; place-items: center; z-index: 50; }
  .qr-modal { width: min(360px, 90vw); background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: 0 24px 60px rgba(15,23,42,.28); text-align: center; }
  .qr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .qr-head strong { font-size: 15px; color: var(--ink); }
  .qr-name { font-size: 13px; color: var(--muted); margin-bottom: 14px; word-break: break-all; }
  .qr-img { width: 260px; height: 260px; max-width: 100%; border-radius: 12px; background: #fff; padding: 10px; border: 1px solid var(--line-2); }
  .qr-hint { font-size: 12px; color: var(--muted-2); margin-top: 14px; }

  /* ---------- 赞赏码弹窗 (donation) ---------- */
  .donate-mask { z-index: 200; background: rgba(15, 23, 42, 0.62); backdrop-filter: blur(4px); }
  .donate-modal { width: min(340px, 92vw); background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 20px 20px 22px; box-shadow: 0 30px 80px rgba(15, 23, 42, 0.45); text-align: center; animation: donatePop 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
  .donate-title { font-size: 17px; font-weight: 800; color: var(--ink); letter-spacing: 0.02em; margin-bottom: 14px; }
  .donate-img { width: 100%; max-width: 280px; border-radius: 14px; display: block; margin: 0 auto; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22); }
  .donate-hint { margin: 14px 4px 18px; font-size: 12.5px; line-height: 1.6; color: var(--muted); }
  .donate-close { width: 100%; padding: 12px; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; color: #fff; background: linear-gradient(135deg, var(--brand), #4f46e5); box-shadow: 0 8px 20px rgba(37, 99, 235, 0.3); transition: filter 0.15s, transform 0.1s; }
  .donate-close:hover { filter: brightness(1.07); }
  .donate-close:active { transform: translateY(1px); }
  .donate-close.waiting { background: var(--soft); color: var(--muted-2); box-shadow: none; cursor: not-allowed; font-variant-numeric: tabular-nums; }
  @keyframes donatePop { from { opacity: 0; transform: scale(0.9) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }

  /* ---------- membership / commerce ---------- */
  .auth-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 10px; background: var(--soft); }
  .auth-tabs button { height: 34px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-weight: 700; }
  .auth-tabs button.active { color: var(--brand); background: var(--card); box-shadow: 0 2px 8px rgba(15,23,42,.08); }
  .member-gate { height: 100vh; overflow-y: auto; padding: 38px; background: radial-gradient(circle at 85% -5%, rgba(37,99,235,.22), transparent 34%), linear-gradient(145deg,#081329,#101d3c 62%,#07111f); }
  .member-center { width: min(1240px,100%); margin: 0 auto; color: #eaf1ff; }
  .member-hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 26px; }
  .member-eyebrow { color: #72a4ff; font-size: 11px; font-weight: 800; letter-spacing: .16em; }
  .member-hero h1 { margin: 7px 0 8px; font-size: clamp(28px,3vw,42px); letter-spacing: -.03em; }
  .member-hero p,.member-modal-head p { margin: 0; color: #9aacca; font-size: 13px; }
  .member-hero>.ghost { color: #dbe7ff; border-color: rgba(255,255,255,.18); background: rgba(255,255,255,.06); }
  .member-alert { margin: 0 0 16px; padding: 11px 13px; border: 1px solid rgba(248,113,113,.35); border-radius: 10px; color: #fecaca; background: rgba(127,29,29,.2); font-size: 12px; }
  .benefit-comparison { margin: 0 0 18px; overflow: hidden; border: 1px solid rgba(143,182,255,.25); border-radius: 16px; background: rgba(255,255,255,.045); }
  .benefit-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 17px; border-bottom: 1px solid rgba(255,255,255,.09); }
  .benefit-title>div { display: grid; gap: 3px; }.benefit-title b { font-size: 14px; }.benefit-title small,.benefit-title>span { color: #8fa0bd; font-size: 10px; }
  .benefit-title>span { padding: 5px 8px; border-radius: 999px; background: rgba(96,165,250,.12); color: #93c5fd; }
  .benefit-grid { display: grid; grid-template-columns: minmax(130px,1.1fr) repeat(2,minmax(150px,1fr)); }
  .benefit-grid>* { min-width: 0; padding: 10px 14px; border-right: 1px solid rgba(255,255,255,.07); border-bottom: 1px solid rgba(255,255,255,.07); font-size: 11px; }
  .benefit-grid>*:nth-child(3n) { border-right: 0; }.benefit-grid>*:nth-last-child(-n+3) { border-bottom: 0; }
  .benefit-grid>div { color: #9aacca; }.benefit-grid>b { color: #dbeafe; text-align: center; }
  .benefit-grid .benefit-tier { color: #dbeafe; background: rgba(255,255,255,.035); font-weight: 800; text-align: center; }
  .benefit-grid .benefit-tier.premium { color: #93c5fd; background: rgba(37,99,235,.15); }
  .benefit-grid .muted-benefit { color: #8392ac; font-weight: 600; }
  .benefit-comparison.compact .benefit-grid>* { padding: 8px 12px; }
  .member-plan-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 15px; }
  .member-plan-grid article { display: flex; flex-direction: column; min-height: 335px; padding: 21px; border: 1px solid rgba(255,255,255,.11); border-radius: 18px; background: rgba(255,255,255,.065); box-shadow: 0 18px 45px rgba(0,0,0,.14); backdrop-filter: blur(14px); }
  .member-plan-grid article.premium { border-color: rgba(96,165,250,.58); background: linear-gradient(155deg,rgba(37,99,235,.27),rgba(255,255,255,.07)); }
  .member-plan-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .member-plan-top span { color: #8fb6ff; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .member-plan-top em { padding: 4px 7px; border-radius: 9px; color: #b8c8e5; background: rgba(255,255,255,.08); font-size: 10px; font-style: normal; }
  .member-plan-grid h2 { margin: 20px 0 7px; font-size: 19px; }
  .member-plan-grid article>p { min-height: 38px; margin: 0; color: #a8b8d2; font-size: 11.5px; line-height: 1.6; }
  .member-plan-grid strong { display: flex; align-items: baseline; gap: 7px; margin: 17px 0 12px; font-size: 31px; letter-spacing: -.03em; }
  .member-plan-grid strong small { margin-right: 3px; font-size: 14px; }
  .member-plan-grid strong del { color: #71819e; font-size: 11px; font-weight: 500; letter-spacing: 0; }
  .member-plan-grid article>.primary { width: 100%; justify-content: center; margin-top: auto; }
  .member-lower { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 16px; }
  .member-panel { overflow: hidden; border: 1px solid rgba(255,255,255,.11); border-radius: 16px; background: rgba(255,255,255,.055); }
  .panel-title { display: flex; justify-content: space-between; padding: 15px 17px; border-bottom: 1px solid rgba(255,255,255,.09); }
  .panel-title span { color: #8fa0bd; font-size: 11px; }
  .member-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; min-height: 60px; padding: 10px 17px; border-bottom: 1px solid rgba(255,255,255,.07); }
  .member-row:last-child { border-bottom: 0; }
  .member-row b { display: block; font-size: 12px; }
  .member-row small { display: block; max-width: 500px; margin-top: 4px; overflow: hidden; color: #8fa0bd; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .member-row>div:last-child { display: flex; gap: 8px; align-items: center; }
  .member-row button { border: 0; background: transparent; color: #8fb6ff; font-size: 11px; }
  .member-row span { color: #fbbf24; font-size: 10px; }
  .member-row span.paid,.current-device { color: #4ade80!important; }
  .member-empty { padding: 20px; color: #8fa0bd; font-size: 11px; text-align: center; }
  .announcements { margin-top: 16px; }
  .announcements time { color: #8fa0bd; font-size: 10px; }
  .payment-sheet { position: sticky; bottom: 18px; display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-top: 16px; padding: 15px 17px; border: 1px solid rgba(96,165,250,.45); border-radius: 15px; background: rgba(9,20,43,.96); box-shadow: 0 18px 50px rgba(0,0,0,.32); backdrop-filter: blur(16px); }
  .payment-sheet span { color: #8fa0bd; font-size: 10px; }
  .payment-sheet h3 { margin: 4px 0; font-size: 15px; }
  .payment-sheet p { margin: 0; color: #9aacca; font-size: 11px; }
  .payment-sheet>div:last-child { display: flex; gap: 9px; }
  .qr-payment { justify-content: flex-start; }
  .payment-qr-box { flex: none; display: grid; justify-items: center; gap: 5px; padding: 8px; border-radius: 12px; color: #dbeafe; background: #fff; }
  .payment-qr-box img { width: 138px; height: 138px; object-fit: contain; }
  .payment-qr-box span { color: #1e3a8a; font-size: 10px; font-weight: 800; }
  .payment-order-info { min-width: 0; flex: 1; }
  .payment-order-info small { display: block; margin-top: 7px; color: #71819e; font-size: 10px; }
  .payment-actions { flex: none; display: grid!important; align-self: stretch; align-content: center; gap: 8px!important; }
  .member-modal-mask { z-index: 180; overflow: auto; padding: 28px; align-items: flex-start; }
  .member-modal { width: min(1120px,96vw); margin: auto; padding: 24px; border: 1px solid #243655; border-radius: 20px; color: #eaf1ff; background: linear-gradient(150deg,#0b1730,#111f3d); box-shadow: 0 30px 90px rgba(0,0,0,.45); }
  .redeem-box { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; padding: 13px 16px; border: 1px solid rgba(52,211,153,.32); border-radius: 12px; background: rgba(16,185,129,.08); }
  .redeem-copy b { display: block; font-size: 13px; }
  .redeem-copy small { color: #9aacca; font-size: 11px; }
  .redeem-form { display: flex; gap: 8px; flex: 1; min-width: 260px; }
  .redeem-form input { flex: 1; min-height: 36px; padding: 0 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 9px; background: rgba(8,16,30,.55); color: #e7eefb; font: inherit; font-size: 12px; }
  .redeem-form button { min-height: 36px; padding: 0 16px; border: 0; border-radius: 9px; background: #10b981; color: #04120c; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
  .pw-block { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
  .pw-head b { font-size: 13px; }
  .pw-head small { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; }
  .pw-form { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .pw-form input { flex: 1; min-width: 150px; min-height: 34px; padding: 0 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--soft); color: var(--ink); font: inherit; font-size: 12.5px; }
  .pw-form button { min-height: 34px; padding: 0 16px; border: 0; border-radius: 9px; background: var(--brand); color: #fff; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .pw-form button:disabled { opacity: .5; cursor: not-allowed; }
  .pw-msg { margin: 8px 0 0; color: #16a34a; font-size: 12px; }
  .pw-msg.bad { color: #dc2626; }
  /* 付款浮层：二维码始终显示在屏幕正中，窗口小的时候浮层内部自己滚动。 */
  .pay-overlay { position: fixed; inset: 0; z-index: 500; display: grid; place-items: center; padding: 24px;
    background: rgba(4,10,22,.72); backdrop-filter: blur(5px); overflow-y: auto; }
  .pay-modal { position: relative; width: min(760px, 100%); max-height: 92vh; overflow-y: auto;
    border: 1px solid rgba(255,255,255,.12); border-radius: 18px; background: #0d1a30;
    box-shadow: 0 30px 90px rgba(0,0,0,.55); }
  /* 浮层内取消原来的 sticky 吸底布局，并把二维码放大到扫码舒适的尺寸。 */
  .pay-modal .payment-sheet { position: static; margin: 0; padding: 26px 26px 22px; border: 0; border-radius: 18px;
    background: transparent; box-shadow: none; align-items: flex-start; gap: 22px; }
  .pay-modal .payment-qr-box { padding: 12px; border-radius: 14px; }
  .pay-modal .payment-qr-box img { width: 220px; height: 220px; }
  .pay-modal .payment-qr-box span { font-size: 12px; }
  .pay-modal .payment-order-info h3 { margin: 8px 0 6px; font-size: 18px; }
  .pay-modal .payment-actions { align-self: center; }
  @media (max-width: 640px) {
    .pay-modal .payment-sheet { flex-direction: column; align-items: stretch; }
    .pay-modal .payment-qr-box { justify-self: center; margin: 0 auto; }
  }
  .pay-close { position: absolute; top: 10px; right: 12px; z-index: 2; width: 30px; height: 30px; padding: 0;
    border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: rgba(255,255,255,.08);
    color: #cfe0f5; font-size: 14px; line-height: 1; cursor: pointer; }
  .pay-close:hover { background: rgba(255,255,255,.16); }
  .split-badge { display: inline-block; padding: 3px 9px; border-radius: 999px; background: rgba(255,120,60,.16); border: 1px solid rgba(255,120,60,.42); color: #ffb27a; font-size: 11px; font-weight: 800; }
  .split-note { margin: 8px 0 0!important; padding: 9px 11px; border-radius: 10px; background: rgba(255,120,60,.12); border: 1px solid rgba(255,120,60,.4); color: #ffcaa0!important; font-size: 12px; line-height: 1.7; }
  .split-note b { color: #fff; }
  .redeem-form button:disabled { opacity: .55; cursor: not-allowed; }
  .redeem-form.vertical { flex-direction: column; }
  .redeem-form.vertical input, .redeem-form.vertical button { width: 100%; min-height: 42px; font-size: 13px; }
  /* 侧边栏常驻兑换入口 */
  .redeem-entry { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 12px; border: 1px solid rgba(52,211,153,.45); border-radius: 11px; background: linear-gradient(120deg,rgba(16,185,129,.18),rgba(16,185,129,.08)); color: #7ff0c6; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: background .15s,border-color .15s; }
  .redeem-entry:hover { background: rgba(16,185,129,.24); border-color: rgba(52,211,153,.7); }
  .redeem-entry i { display: inline-flex; width: 17px; height: 17px; }
  .redeem-entry i :global(svg) { width: 100%; height: 100%; }
  /* 独立兑换弹窗 */
  .redeem-modal { width: min(460px,94vw); margin: auto; padding: 22px; border: 1px solid #243655; border-radius: 18px; color: #eaf1ff; background: linear-gradient(150deg,#0b1730,#111f3d); box-shadow: 0 30px 90px rgba(0,0,0,.45); }
  .redeem-modal-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .redeem-modal-head h2 { margin: 4px 0 0; font-size: 18px; }
  .redeem-modal-tip { margin: 0 0 16px; color: #9aacca; font-size: 12px; line-height: 1.6; }
  .redeem-modal-err { margin: 12px 0 0; padding: 9px 12px; border: 1px solid rgba(248,113,113,.35); border-radius: 9px; background: rgba(248,113,113,.1); color: #fca5a5; font-size: 12px; }
  .member-modal-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .member-modal-head h2 { margin: 5px 0; }
  .member-head-actions { display: flex; align-items: center; gap: 8px; }
  .member-refresh { min-height: 32px; padding: 0 11px; border: 1px solid rgba(143,182,255,.35); border-radius: 9px; color: #bfdbfe; background: rgba(255,255,255,.06); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
  .member-refresh:hover:not(:disabled) { background: rgba(59,130,246,.2); }
  .member-refresh:disabled { cursor: wait; opacity: .65; }
  .member-modal .icon-btn, .redeem-modal .icon-btn { color: #dbe7ff; border: 1px solid rgba(255,255,255,.15); }
  .member-account-summary { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 1px; margin: 0 0 16px; overflow: hidden; border: 1px solid rgba(255,255,255,.11); border-radius: 13px; background: rgba(255,255,255,.11); }
  .member-account-summary>div { min-width: 0; padding: 12px 14px; background: rgba(255,255,255,.045); }
  .member-account-summary span { display: block; margin-bottom: 5px; color: #8fa0bd; font-size: 10px; }
  .member-account-summary b { display: block; overflow: hidden; color: #edf4ff; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .plan-load-alert { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .member-plans-empty { display: flex; grid-column: 1 / -1; min-height: 170px; align-items: center; justify-content: center; flex-direction: column; gap: 10px; border: 1px dashed rgba(143,182,255,.35); border-radius: 14px; color: #cbd9ef; text-align: center; }
  .member-plans-empty b { font-size: 14px; }
  .member-plans-empty span { color: #8fa0bd; font-size: 11px; }
  .member-plans-empty .primary { width: auto; padding: 0 15px; }
  .plan-sections { display: grid; gap: 22px; }
  .plan-section { display: grid; gap: 11px; }
  .plan-section-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 0 2px; }
  .plan-section-title h3 { margin: 0 0 3px; font-size: 17px; }
  .plan-section-title p { margin: 0; color: #8fa0bd; font-size: 11px; }
  .plan-section-title>span { flex: none; color: #7890b5; font-size: 10px; }
  .member-plan-grid.compact { grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
  .member-plan-grid.compact article { min-height: 226px; padding: 17px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,.11); transition: border-color .18s,transform .18s,background .18s; }
  .member-plan-grid.compact article:hover { transform: translateY(-2px); border-color: rgba(143,182,255,.42); background: rgba(255,255,255,.085); }
  .member-plan-grid.compact article.premium:hover { border-color: rgba(96,165,250,.82); background: linear-gradient(155deg,rgba(37,99,235,.34),rgba(255,255,255,.09)); }
  .member-plan-grid.compact h2 { margin: 14px 0 5px; font-size: 17px; }
  .member-plan-grid.compact article>p { min-height: 36px; font-size: 11px; line-height: 1.55; }
  .member-plan-grid.compact strong { margin: 12px 0 11px; font-size: 28px; }
  .plan-highlights { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
  .plan-highlights span { padding: 5px 8px; border: 1px solid rgba(143,182,255,.16); border-radius: 999px; color: #b8c8e5; background: rgba(255,255,255,.045); font-size: 9.5px; }
  .lifetime-plan { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 28px; padding: 20px 22px; border: 1px solid rgba(96,165,250,.62); border-radius: 17px; background: radial-gradient(circle at 90% 20%,rgba(59,130,246,.23),transparent 34%),linear-gradient(140deg,rgba(37,99,235,.22),rgba(255,255,255,.055)); box-shadow: 0 14px 36px rgba(0,0,0,.14); }
  .lifetime-copy h3 { margin: 11px 0 5px; font-size: 20px; }
  .lifetime-copy p { max-width: 700px; margin: 0 0 12px; color: #a8b8d2; font-size: 11.5px; line-height: 1.6; }
  .lifetime-copy .plan-highlights { margin-bottom: 0; }
  .lifetime-buy { display: grid; min-width: 172px; justify-items: stretch; gap: 9px; }
  .lifetime-buy strong { display: flex; align-items: baseline; justify-content: center; gap: 6px; font-size: 31px; letter-spacing: -.03em; }
  .lifetime-buy strong small { font-size: 14px; }
  .lifetime-buy strong del { color: #71819e; font-size: 11px; font-weight: 500; letter-spacing: 0; }
  .lifetime-buy .primary { width: 100%; justify-content: center; }
  .device-limit-panel { margin-top: 18px; }

  @media (max-width: 700px) {
    .member-modal-mask { padding: 12px; }
    .member-modal { width: 100%; padding: 16px; }
    .member-account-summary { grid-template-columns: repeat(2,minmax(0,1fr)); }
    .member-lower { grid-template-columns: 1fr; }
    .benefit-grid { grid-template-columns: minmax(95px,.8fr) repeat(2,minmax(105px,1fr)); }
    .benefit-grid>* { padding: 8px; font-size: 9px; }
    .member-plan-grid.compact { grid-template-columns: 1fr; }
    .lifetime-plan { grid-template-columns: 1fr; gap: 16px; }
    .lifetime-buy { min-width: 0; }
    .qr-payment { position: static; flex-direction: column; align-items: stretch; }
    .payment-qr-box { justify-self: center; }
    .payment-actions { grid-template-columns: 1fr 1fr; }
  }
  .member-lower.compact { margin-top: 15px; }

  /* ---------- responsive breakpoints ---------- */
  @media (max-width: 1180px) {
    .cols { grid-template-columns: 1fr; }
  }
  /* rail sits below main: on roomy widths let its two cards share a row */
  @media (max-width: 1180px) and (min-width: 760px) {
    .col-rail { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 1080px) {
    :global(:root) { --side-w: 208px; }
    .scroll { padding: var(--s4); }
  }
  @media (max-width: 900px) {
    .proto-field { display: none; }
    .metric.col { display: none; }
    .account-chip div { display: none; }
    .account-chip { padding-right: 6px; }
    .account-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
  }
  /* narrow: reflow the wide tables into stacked cards (no page scroll, nothing clipped) */
  @media (max-width: 820px) {
    .tscroll { overflow: visible; margin: 0; padding: 0; }
    .rtable, .ntable { min-width: 0; gap: 10px; }
    .rhead, .nhead { display: none; }
    .rrow, .nrow {
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
      padding: 14px 12px; border: 1px solid var(--line); border-radius: var(--r3);
    }
    .rrow .app-cell, .nrow .ncell { flex: 1 1 100%; }
    .rrow .line-select { order: 2; flex: 1 1 160px; }
    .rrow .switch, .rrow .icon-btn.ctr { margin-left: auto; }
    .nrow .row-actions { margin-left: auto; }
    .sub-row { grid-template-columns: 1fr auto; }
    .sub-meta { grid-column: 1 / -1; }
    .line-list-head { display: none; }
    .line-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r3); }
    .line-row .line-name { flex: 1 1 100%; }
    .line-row .row-actions { margin-left: auto; }
  }
  @media (max-width: 760px) {
    :global(:root) { --side-w: 76px; }
    .brand-title { display: none; }
    .brand { justify-content: center; padding: 2px 0 22px; }
    .side-nav button { justify-content: center; padding: 0; gap: 0; }
    .side-nav button span { display: none; }
    .core-card > div, .foot-icons { display: none; }
    .redeem-entry span { display: none; }
    .redeem-entry { padding: 0; gap: 0; }
    .core-card { justify-content: center; padding: 11px 0; }
  }
  @media (max-width: 620px) {
    .scroll { padding: var(--s3); }
    .card { padding: var(--s4); }
    .tscroll { margin: 0; padding: 0; }
    .power-btn span { display: inline; }
    .route-master { flex: 1 1 100%; }
    .account-grid { grid-template-columns: 1fr; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
  }
</style>
