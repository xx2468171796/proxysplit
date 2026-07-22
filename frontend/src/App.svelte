<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import {
    AddNodes as WAddNodes,
    AddManualNode as WAddManualNode,
    GetNodes as WGetNodes,
    RemoveNode as WRemoveNode,
    SelectNode as WSelectNode,
    ListProcesses as WListProcesses,
    Start as WStart,
    Stop as WStop,
    GetStatus as WGetStatus,
    GetAppRules as WGetAppRules,
    SetAppRules as WSetAppRules,
    GetRuleMode as WGetRuleMode,
    SetRuleMode as WSetRuleMode,
    TestAllLatency as WTestAllLatency,
    GetAppIcon as WGetAppIcon,
    GetSubs as WGetSubs,
    AddSub as WAddSub,
    UpdateSub as WUpdateSub,
    RemoveSub as WRemoveSub,
    SetSubAutoUpdate as WSetSubAutoUpdate,
    GetCoreVersion as WGetCoreVersion,
    UpdateCore as WUpdateCore,
    GetSettings as WGetSettings,
    SetSettings as WSetSettings,
    GetRouting as WGetRouting,
    SetRouting as WSetRouting,
    UpdateRuleSets as WUpdateRuleSets,
    GetLines as WGetLines,
    SetLines as WSetLines,
    GetDefaultLine as WGetDefaultLine,
    SetDefaultLine as WSetDefaultLine,
    GetClashMode as WGetClashMode,
    SetClashMode as WSetClashMode,
    GetSystemProxy as WGetSystemProxy,
    SetSystemProxy as WSetSystemProxy,
    SpeedTest as WSpeedTest,
    GetNodeQR as WGetNodeQR,
    GetAutostart as WGetAutostart,
    SetAutostart as WSetAutostart,
    GetLogLevel as WGetLogLevel,
    SetLogLevel as WSetLogLevel,
    ExportAppRules as WExportAppRules,
    ImportAppRules as WImportAppRules,
    GetLanIP as WGetLanIP,
    GetAIControlInfo as WGetAIControlInfo,
    PickExeFiles as WPickExeFiles,
    TestApp as WTestApp,
    ExportConfig as WExportConfig,
    ImportConfig as WImportConfig,
    GetHealth as WGetHealth,
    GetRuleSets as WGetRuleSets,
    ResetConfig as WResetConfig,
    GetCustomRules as WGetCustomRules,
    SetCustomRules as WSetCustomRules,
  } from '../wailsjs/go/main/App.js'
  import { EventsOn } from '../wailsjs/runtime/runtime.js'
  import donateQR from './assets/images/donate.png'

  type Tab = 'overview' | 'nodes' | 'apps' | 'rules' | 'subs' | 'logs' | 'settings'
  type RuleSet = { name: string; display: string; desc: string; sizeKB: number; modified: string; present: boolean }
  type Node = {
    id: string
    name: string
    type: string
    server: string
    port: number
    network?: string
    security?: string
    latency?: number
    speed?: number
    region?: string // color key for the flag dot
  }
  type Proc = { name: string; desc?: string; path: string; count: number }
  type AppRule = {
    match: string
    path: string
    line: string // line id (see Line)
    enabled: boolean
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
    stats?: { activeConns: number; totalConns: number; tracked: number; upBytes: number; downBytes: number }
  }
  type Sub = { id: string; name: string; url: string; autoUpdate: boolean; lastUpdate: string; nodeCount: number }
  type RouteRule = { type: string; value: string; action: string }
  type Routing = { enabled: boolean; mode: string; rules: RouteRule[] }
  type Settings = {
    mixedPort: number; tunMode: boolean; lanShare: boolean; excludeSelf: boolean; privateDirect: boolean; blockQUIC: boolean
    remoteDNS: boolean; fakeIP: boolean; autostart: boolean; trayClose: boolean; theme: string
    lanPort: number; lanType: string; lanUser: string; lanPass: string
  }

  // --- demo data (matches the design mockup 1:1, shown in browser preview) ---
  const demoNodes: Node[] = [
    { id: 'jp', name: 'JP | Tokyo - 01', type: 'vless', server: 'jp01.example.net', port: 443, latency: 48, speed: 12.45, region: 'jp' },
    { id: 'us', name: 'US | Los Angeles - 02', type: 'vless', server: 'us02.example.net', port: 443, latency: 126, speed: 8.73, region: 'us' },
    { id: 'sg', name: 'SG | Singapore - 01', type: 'trojan', server: 'sg01.example.net', port: 443, latency: 60, speed: 9.12, region: 'sg' },
    { id: 'hk', name: 'HK | Hong Kong - 01', type: 'vless', server: 'hk01.example.net', port: 443, latency: 72, speed: 7.45, region: 'hk' },
    { id: 'de', name: 'DE | Frankfurt - 01', type: 'vmess', server: 'de01.example.net', port: 443, latency: 162, speed: 6.21, region: 'de' },
  ]
  const demoRules: AppRule[] = [
    { match: 'Code.exe', path: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', line: 'rule', enabled: true },
    { match: 'chrome.exe', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', line: 'rule', enabled: true },
    { match: 'Telegram.exe', path: 'C:\\Users\\%USERNAME%\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe', line: 'global', enabled: true },
    { match: 'msedge.exe', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', line: 'direct', enabled: false },
    { match: 'Steam.exe', path: 'C:\\Program Files (x86)\\Steam\\steam.exe', line: 'us', enabled: true },
  ]
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
    coreRunning: true, engineRunning: true, corePort: 10808,
    nodeName: 'JP | Tokyo - 01', selectedId: 'jp', ruleMode: 'blacklist', uptimeSec: 12 * 60 + 34,
    stats: { activeConns: 24, totalConns: 1826, tracked: 5, upBytes: 0, downBytes: 0 },
  }
  const demoSubs: Sub[] = [
    { id: 'a', name: '机场订阅 A', url: 'https://sub.example.com/a', autoUpdate: true, lastUpdate: '2 小时前', nodeCount: 36 },
    { id: 'b', name: '备用订阅', url: 'https://sub.example.com/b', autoUpdate: false, lastUpdate: '手动', nodeCount: 12 },
  ]
  const demoSettings: Settings = {
    mixedPort: 10808, tunMode: false, lanShare: false, excludeSelf: true, privateDirect: true, blockQUIC: true,
    remoteDNS: true, fakeIP: false, autostart: false, trayClose: true, theme: 'light',
    lanPort: 7890, lanType: 'mixed', lanUser: '', lanPass: '',
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
  let ruleMode: 'blacklist' | 'whitelist' = 'whitelist' // 只代理列出的（默认/推荐）
  let linkText = ''
  let addMsg = ''
  let query = ''
  let newApp = ''
  let procs: Proc[] = []
  let procFilter = ''
  let showPicker = false
  let busy = false
  let logFilter = ''
  let showSubForm = false
  let subName = ''
  let subUrl = ''
  let subAuto = false
  let subMsg: Record<string, string> = {} // per-row update status keyed by sub id
  let coreVersion = '1.13.14'
  let coreMsg = ''
  let ruleSetMsg = ''
  let showLineForm = false
  let lineForm: { id: string; name: string; node: string; mode: string; rules: RouteRule[] } = { id: '', name: '', node: 'active', mode: 'global', rules: [] }
  let clashMode = 'rule' // 'rule' | 'global' | 'direct' — 主控:流量走向 (no restart)
  let sysProxy = false // Windows system proxy on/off
  let speedMsg = '' // download speed test result / status
  let speedTesting = false
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
  let useDemo = false

  const isWailsReady = () => typeof window !== 'undefined' && !!(window as any).go?.main?.App
  async function safe<T>(call: () => Promise<T>, fallback: T): Promise<T> {
    if (!isWailsReady()) { useDemo = true; return fallback }
    // A transient backend error must NOT flip the whole app into demo mode.
    // Also coerce null/undefined to the fallback: Go marshals a nil slice to
    // JSON `null`, and a null reaching a {#each}/.length throws inside Svelte's
    // flush(), which re-throws without clearing update_scheduled and wedges the
    // scheduler → the whole UI freezes. `?? fallback` keeps 0/false/'' intact.
    try { const r = await call(); return r ?? fallback } catch (e) { console.warn('[ProxySplit] call failed', e); return fallback }
  }

  $: running = !!status && (status.coreRunning || status.engineRunning)
  $: selectedNode = nodes.find((n) => n.id === status?.selectedId) || nodes[0]
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
  $: rules.forEach((r) => loadIcon(r.path))
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
  function firstChar(s: string): string { return s && s.length ? s[0] : '?' }
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

  // Persist the AppRule[] model straight to the backend.
  async function pushRules() {
    if (useDemo || !isWailsReady()) return
    await WSetAppRules(rules)
  }

  async function refreshNodes() { nodes = await safe(() => WGetNodes() as Promise<Node[]>, demoNodes) }
  async function refreshStatus() {
    status = await safe(() => WGetStatus() as Promise<Status>, demoStatus)
    const s = status?.stats
    const now = Date.now()
    if (s && prevT) {
      const dt = (now - prevT) / 1000
      if (dt > 0) {
        downRate = Math.max(0, s.downBytes - prevDown) / dt
        upRate = Math.max(0, s.upBytes - prevUp) / dt
      }
    }
    if (s) { prevDown = s.downBytes; prevUp = s.upBytes; prevT = now }
  }
  const demoHealth: Health = { running: true, capturing: true, capturedPkts: 12873, warning: '',
    lines: [ { id: 'rule', name: '规则', node: 'JP | Tokyo - 01', latency: 48, ok: true },
             { id: 'global', name: '全局', node: 'JP | Tokyo - 01', latency: 48, ok: true },
             { id: 'us', name: '美区-全局', node: 'US | Los Angeles - 02', latency: 126, ok: true } ] }
  async function refreshHealth() { health = await safe<Health>(() => WGetHealth() as Promise<Health>, demoHealth) }
  async function refreshRules() {
    if (!isWailsReady()) { useDemo = true; rules = demoRules; recent = demoLogs; return }
    // Real backend path: fall back to EMPTY (not demoRules) so a genuinely
    // empty rule set never shows phantom demo apps the user didn't add.
    const list = await safe(() => WGetAppRules() as Promise<AppRule[]>, [] as AppRule[])
    // Per-app action: 规则(rule) / 全局(global) / 直连(direct) / 拦截(block).
    // Normalize any legacy/custom line id to one of these four (default 规则).
    rules = list.map((r) => ({ match: r.match, path: r.path, line: ['global', 'direct', 'block'].includes(r.line) ? r.line : 'rule', enabled: !!r.enabled }))
  }
  async function refreshSubs() { subs = isWailsReady() ? await safe(() => WGetSubs() as Promise<Sub[]>, [] as Sub[]) : demoSubs }
  async function refreshSettings() { settings = await safe(() => WGetSettings() as Promise<Settings>, demoSettings) }
  async function refreshRouting() {
    routing = await safe(() => WGetRouting() as Promise<Routing>, { enabled: true, mode: 'global', rules: [] })
    if (!routing.rules) routing.rules = []
    if (typeof routing.enabled !== 'boolean') routing.enabled = true
  }
  async function saveRouting() {
    if (useDemo || !isWailsReady()) return
    await WSetRouting({ enabled: routing.enabled, mode: routing.mode, rules: routing.rules.filter((r) => r.value.trim()) })
  }
  // --- lines (routing targets) + default line (whitelist) ---
  async function refreshLines() { lines = await safe(() => WGetLines() as Promise<Line[]>, demoLines) }
  async function refreshDefaultLine() {
    defaultLine = await safe<string>(() => WGetDefaultLine(), 'rule')
    if (!defaultLine) defaultLine = 'rule'
  }
  async function applyDefaultLine() { if (useDemo || !isWailsReady()) return; await WSetDefaultLine(defaultLine) }

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
    else { await WSetLines(custom); await refreshLines() }
    showLineForm = false
  }
  async function deleteLine(l: Line) {
    const custom = lines.filter((x) => !x.builtin && x.id !== l.id)
    if (useDemo || !isWailsReady()) { lines = [...lines.filter((x) => x.builtin), ...custom] }
    else { await WSetLines(custom); await refreshLines() }
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
    { name: 'geosite-cn.srs', display: '国内网站 (geosite-cn)', desc: '识别大陆网站域名 → 直连不走代理', sizeKB: 52, modified: '2026-07-06', present: true },
    { name: 'geoip-cn.srs', display: '国内 IP (geoip-cn)', desc: '识别大陆 IP 段 → 直连不走代理', sizeKB: 33, modified: '2026-07-06', present: true },
    { name: 'geosite-category-ads-all.srs', display: '广告域名 (ads)', desc: '广告/追踪域名 → 直接拦截', sizeKB: 8, modified: '2026-07-06', present: true },
  ]
  async function refreshRuleSets() { ruleSets = await safe<RuleSet[]>(() => WGetRuleSets() as Promise<RuleSet[]>, demoRuleSets) }
  let customRules: RouteRule[] = []
  let custRuleMsg = ''
  async function refreshCustomRules() { customRules = await safe<RouteRule[]>(() => WGetCustomRules() as Promise<RouteRule[]>, []) }
  function addCustomRule() { customRules = [...customRules, { type: 'suffix', value: '', action: 'proxy' }] }
  function removeCustomRule(i: number) { customRules = customRules.filter((_, k) => k !== i) }
  async function saveCustomRules() {
    if (useDemo || !isWailsReady()) { custRuleMsg = '演示模式无法保存'; setTimeout(() => (custRuleMsg = ''), 2500); return }
    custRuleMsg = '应用中…'
    await WSetCustomRules(customRules.filter((r) => (r.value || '').trim()))
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
    await WSetRuleMode(ruleMode)
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
    const procs = await safe<Proc[]>(() => WListProcesses() as Promise<Proc[]>, [])
    const set = new Set<string>()
    for (const p of procs) set.add((p.name || '').toLowerCase())
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
    if (useDemo || !isWailsReady()) return
    try { await WTestAllLatency() } catch {}
    await refreshNodes()
  }

  // --- 一键切模式 (clash mode: 规则/全局/直连, no restart) ---
  async function refreshClashMode() { clashMode = await safe<string>(() => WGetClashMode(), clashMode) }
  async function setClash(mode: string) {
    if (clashMode === mode) return
    clashMode = mode
    if (useDemo || !isWailsReady()) { pushLog('[ui] 演示：切换模式 ' + mode); return }
    const err = await WSetClashMode(mode)
    if (err) { pushLog('[error] 切换模式失败: ' + err); toast('切换失败: ' + err) }
  }
  function cycleClash() {
    const order = ['rule', 'global', 'direct']
    setClash(order[(order.indexOf(clashMode) + 1) % order.length])
  }
  function clashLabel(m: string): string { return m === 'global' ? '全局' : m === 'direct' ? '直连' : '规则' }

  // --- 系统代理开关 ---
  async function refreshSysProxy() { sysProxy = await safe<boolean>(() => WGetSystemProxy(), sysProxy) }
  async function toggleSysProxy() {
    const want = !sysProxy
    if (useDemo || !isWailsReady()) { sysProxy = want; pushLog('[ui] 演示：系统代理 ' + (want ? '开' : '关')); return }
    const err = await WSetSystemProxy(want)
    if (err) { toast(err); pushLog('[error] 系统代理: ' + err) }
    await refreshSysProxy()
  }

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
    try { await WSetSettings(settings); await refreshStatus() } finally { switchingMode = false }
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
    const err = await WImportAppRules(text)
    if (err) { rulesMsg = '导入失败: ' + err }
    else { rulesMsg = '导入成功'; await refreshRules(); await refreshLines() }
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
    if (!useDemo && isWailsReady()) await WSetSettings(settings)
  }

  // --- real-time status / line detection (reactive so it tracks `health`) ---
  $: capB = !health.running ? { t: '未运行', c: 'idle' }
    : health.warning ? { t: '分流异常', c: 'bad' }
    : health.capturing ? { t: '分流运行中', c: 'ok' }
    : { t: '等待流量…', c: 'wait' }
  function lhLat(l: LineHealth): string {
    if (l.node === '直连' || l.node === '拦截') return l.node
    if (l.latency < 0) return '不通'
    if (l.latency === 0) return '—'
    return l.latency + ' ms'
  }

  // --- overview derived state (reactive so it updates when nodes/status/mode change) ---
  $: activeNodeObj = nodes.find((n) => n.id === status?.selectedId)
  $: clashHintText =
    clashMode === 'global' ? '全局：所有被接管的流量都走活动节点。'
    : clashMode === 'direct' ? '直连：所有流量直连，相当于暂停代理（不断线）。'
    : '规则：按你的应用/线路规则智能分流（大陆直连、境外走代理）。'
  $: statusText = `${settings.tunMode ? '整机全局' : '应用分流'} · 策略「${
    clashMode === 'global' ? '全局' : clashMode === 'direct' ? '直连' : '规则'
  }」· 节点 ${activeNodeObj?.name || '未选'}`
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
    coreVersion = await safe<string>(() => WGetCoreVersion(), '1.13.14')
    if (!coreVersion) coreVersion = '1.13.14'
  }
  async function updateCore() {
    if (coreMsg === '检查中…') return
    coreMsg = '检查中…'
    const res = await safe<string>(() => WUpdateCore(), coreVersion)
    if (res.indexOf('ERR:') === 0) { coreMsg = '失败：' + res.slice(4) }
    else { coreVersion = res || coreVersion; coreMsg = '已更新到 v' + coreVersion + '（重启生效）' }
    setTimeout(() => (coreMsg = ''), 4500)
  }
  async function saveSettings() {
    if (useDemo || !isWailsReady()) return
    await WSetSettings(settings)
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
          const adminish = /admin|windivert|管理员|driver/i.test(err)
          toast(adminish ? '启动失败：请关闭后「右键 → 以管理员身份运行」' : '启动失败：' + err)
        }
      }
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

  onMount(async () => {
    if (isWailsReady()) EventsOn('log', (line: string) => pushLog(line))
    await refreshNodes(); await refreshLines(); await refreshRules(); await refreshStatus()
    await refreshSubs(); await refreshSettings(); await refreshRouting(); await refreshDefaultLine()
    await refreshCoreVersion(); await refreshClashMode(); await refreshSysProxy()
    await refreshAutostart(); await refreshLogLevel()
    lanIP = await safe<string>(() => WGetLanIP(), '192.168.1.100')
    await refreshRunning(); await refreshHealth(); await refreshRuleSets(); await refreshAIInfo()
    themePref = settings.theme || 'light'; applyTheme(themePref)
    const m = await safe<string>(() => WGetRuleMode(), ruleMode)
    ruleMode = m === 'blacklist' ? 'blacklist' : 'whitelist'
    if (useDemo && recent.length === 0) recent = demoLogs
    timer = setInterval(() => { refreshStatus(); refreshHealth() }, 1000)
    openDonate() // 每次启动强制弹出赞赏码
  })
  onDestroy(() => { if (timer) clearInterval(timer); if (donateTimer) clearInterval(donateTimer) })

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
    bars: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="14" width="3.5" height="6" rx="1"/><rect x="8.2" y="10" width="3.5" height="10" rx="1"/><rect x="13.4" y="6" width="3.5" height="14" rx="1"/><rect x="18.6" y="14" width="3.5" height="6" rx="1" opacity=".35"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v8M7.5 7a7 7 0 1 0 9 0"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7M14 21h3"/></svg>',
    gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/><circle cx="12" cy="18" r="1.2" fill="currentColor"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>',
  }
  function qual(ms?: number) { return !ms ? 0 : ms < 80 ? 4 : ms < 130 ? 3 : ms < 200 ? 2 : 1 }
</script>

<svelte:head><title>ProxySplit</title></svelte:head>

<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">◑</div>
      <div class="brand-title">ProxySplit</div>
    </div>

    <nav class="side-nav">
      <button class:active={tab === 'overview'} on:click={() => (tab = 'overview')}><i>{@html I.dash}</i><span>概览</span></button>
      <button class:active={tab === 'nodes'} on:click={() => (tab = 'nodes')}><i>{@html I.nodes}</i><span>节点</span></button>
      <button class:active={tab === 'apps'} on:click={() => { tab = 'apps'; refreshRunning() }}><i>{@html I.apps}</i><span>应用分流</span></button>
      <button class:active={tab === 'rules'} on:click={() => { tab = 'rules'; refreshRuleSets(); refreshCustomRules() }}><i>{@html I.shield}</i><span>分流规则</span></button>
      <button class:active={tab === 'subs'} on:click={() => (tab = 'subs')}><i>{@html I.subs}</i><span>订阅</span></button>
      <button class:active={tab === 'logs'} on:click={() => (tab = 'logs')}><i>{@html I.logs}</i><span>日志</span></button>
      <button class:active={tab === 'settings'} on:click={() => (tab = 'settings')}><i>{@html I.settings}</i><span>设置</span></button>
    </nav>

    <div class="sidebar-foot">
      <div class="core-card">
        <span class="dot" class:on={status?.coreRunning}></span>
        <div><strong>{status?.coreRunning ? '核心运行中' : '核心已停止'}</strong><small>sing-box {coreVersion || '1.13.14'}</small></div>
      </div>
      <div class="foot-icons">
        <button title="下载">{@html I.dl}</button>
        <button title="GitHub">{@html I.gh}</button>
        <button title="关于">{@html I.info}</button>
      </div>
    </div>
  </aside>

  <section class="workspace">
    <header class="topbar">
      <div class="tb-left">
        <div class="tb-field">
          <label>活动节点 <span class="node-dot" class:on={running}></span></label>
          <select on:change={onNodeChange}>
            {#each nodes as n}<option value={n.id} selected={n.id === status?.selectedId}>{n.name}</option>{/each}
          </select>
        </div>
        <div class="tb-field">
          <label>代理策略</label>
          <div class="mode-seg" title="切换代理策略：规则=智能分流 / 全局=全走代理 / 直连=全不走（不重启）">
            <button class:on={clashMode === 'rule'} on:click={() => setClash('rule')}>规则</button>
            <button class:on={clashMode === 'global'} on:click={() => setClash('global')}>全局</button>
            <button class:on={clashMode === 'direct'} on:click={() => setClash('direct')}>直连</button>
          </div>
        </div>
      </div>

      <div class="tb-right">
        <div class="metric"><span class="mi down">{@html I.down}</span><b>{dn.v}</b> {dn.u}</div>
        <div class="metric"><span class="mi up">{@html I.up}</span><b>{up.v}</b> {up.u}</div>
        <div class="metric col"><span class="mi">{@html I.users}</span><div><small>活动连接</small><b>{activeConns}</b></div></div>
        <div class="conn" class:on={running}>
          <span class="mi">{@html I.wifi}</span>
          <div><small>{running ? '已连接' : '未连接'}</small><b>{uptime}</b></div>
        </div>
        <button class="power-btn" class:running on:click={toggleRun} disabled={busy}>
          {@html running ? I.stop : I.power}<span>{busy ? '…' : running ? '停止' : '启动'}</span>
        </button>
      </div>
    </header>

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
        <div class="ov">
          {#if !useDemo && nodes.length === 0}
            <section class="card firstrun">
              <div class="fr-head"><h2>三步开始使用</h2><p>配置会自动保存在本地，下次打开直接用，不用重设。</p></div>
              <div class="fr-steps">
                <div class="fr-step"><span class="fr-n">1</span><div class="fr-txt"><strong>添加节点</strong><small>粘贴机场链接，或手动填 SOCKS5 / HTTP</small></div><button class="btn pri" on:click={() => (tab = 'nodes')}>去添加</button></div>
                <div class="fr-step"><span class="fr-n">2</span><div class="fr-txt"><strong>选择应用</strong><small>指定哪些程序走代理（默认智能分流：境外走代理、大陆直连）</small></div><button class="btn" on:click={() => (tab = 'apps')}>去选择</button></div>
                <div class="fr-step"><span class="fr-n">3</span><div class="fr-txt"><strong>启动</strong><small>点右上角「启动」，之后就按应用自动分流</small></div></div>
              </div>
            </section>
          {/if}
          <section class="card ov-hero" class:live={running}>
            <div class="ov-hero-main">
              <div class="ov-status">
                <span class="ov-dot" class:on={running}></span>
                <div><h2>{running ? '正在运行' : '已停止'}</h2><p>{running ? statusText : '点「启动」开始代理'}</p></div>
              </div>
              <button class="power-btn lg" class:running on:click={toggleRun} disabled={busy}>
                {@html running ? I.stop : I.power}<span>{busy ? '…' : running ? '停止' : '启动'}</span>
              </button>
            </div>
            <div class="ov-stats">
              <div class="ov-stat"><small>下行</small><b>{dn.v}</b><em>{dn.u}</em></div>
              <div class="ov-stat"><small>上行</small><b>{up.v}</b><em>{up.u}</em></div>
              <div class="ov-stat"><small>活动连接</small><b>{activeConns}</b></div>
              <div class="ov-stat"><small>运行时长</small><b>{uptime}</b></div>
            </div>
          </section>

          <div class="ov-grid">
            <section class="card">
              <div class="card-head sm"><div><h3>代理范围</h3><p class="sub">哪些流量被代理接管</p></div></div>
              <div class="mode-choice">
                <button class="mc" class:on={!settings.tunMode} on:click={() => setCaptureMode(false)} disabled={switchingMode}>
                  <strong>只代理指定应用</strong><small>只有你在「应用分流」里选的程序走代理,其余直连。招牌能力。</small>
                </button>
                <button class="mc" class:on={settings.tunMode} on:click={() => setCaptureMode(true)} disabled={switchingMode}>
                  <strong>整机全局</strong><small>整台电脑所有流量都走代理(像 v2rayN),老程序、游戏也覆盖。</small>
                </button>
              </div>
              {#if switchingMode}<p class="mode-hint">切换中，正在重启内核…</p>{/if}
            </section>

            <section class="card">
              <div class="card-head sm"><div><h3>代理策略</h3><p class="sub">接管后流量往哪走,随时切、不重启</p></div></div>
              <div class="mode-seg lg full">
                <button class:on={clashMode === 'rule'} on:click={() => setClash('rule')}>规则</button>
                <button class:on={clashMode === 'global'} on:click={() => setClash('global')}>全局</button>
                <button class:on={clashMode === 'direct'} on:click={() => setClash('direct')}>直连</button>
              </div>
              <p class="mode-hint">{clashHintText}</p>
            </section>

            <section class="card">
              <div class="card-head sm"><div><h3>活动节点</h3></div><button class="link" on:click={() => (tab = 'nodes')}>管理节点 {@html I.chevron}</button></div>
              <div class="ov-node">
                <span class="flag {activeNodeObj?.region || 'x'}"></span>
                <div class="grow"><strong>{activeNodeObj?.name || '未选择节点'}</strong><small>{activeNodeObj ? activeNodeObj.server + ':' + activeNodeObj.port : '去「节点」页添加并选择一个'}</small></div>
                {#if activeNodeObj?.latency}<span class="lat" data-q={qual(activeNodeObj?.latency)}>{activeNodeObj?.latency} ms</span>{/if}
              </div>
            </section>

            <section class="card">
              <div class="card-head sm"><div><h3>系统代理 <span class="opt-tag">可选</span></h3><p class="sub">给「不被应用分流抓到、但认系统代理」的老程序补充用</p></div>
                <label class="switch"><input type="checkbox" checked={sysProxy} on:change={toggleSysProxy} /><i></i></label></div>
              <p class="mode-hint">{sysProxy ? '已开启：系统 HTTP 代理指向本机' : '一般不用开 —— 点上面「启动」就已按应用分流。只有个别老程序抓不到时才需要它。'}</p>
            </section>
          </div>

          <section class="card">
            <div class="card-head sm">
              <div><h3>实时状态 · 线路检测</h3><p class="sub">内核按进程分流 · 各节点连通性（每 10 秒刷新）</p></div>
              <span class="cap-badge {capB.c}">{capB.t}{#if health.capturing && health.capturedPkts} · {health.capturedPkts} 包{/if}</span>
            </div>
            <div class="lh-list">
              <div class="lh-head"><span></span><span>线路</span><span>出口节点</span><span class="r">延迟</span></div>
              {#each (health.lines || []) as l}
                <div class="lh-row">
                  <span class="lh-dot" class:ok={l.ok && l.latency !== -1} class:bad={l.latency === -1}></span>
                  <span class="lh-name">{l.name}</span>
                  <span class="lh-node">{l.node}</span>
                  <span class="lh-lat r" data-q={qual(l.latency > 0 ? l.latency : undefined)} class:err={l.latency === -1}>{lhLat(l)}</span>
                </div>
              {/each}
              {#if !health.lines || health.lines.length === 0}<div class="empty sm">暂无线路数据</div>{/if}
            </div>
          </section>
        </div>
      {:else if tab === 'apps'}
        <div class="cols">
          <div class="col-main">
            <section class="card hero">
              <div class="hero-icon">{@html I.apps}</div>
              <div class="hero-text">
                <div class="hero-head"><h2>应用分流</h2><a class="help">{@html I.help} 使用说明</a></div>
                <p>仅对选中的应用走代理，未选中的应用直接连接网络。</p>
                {#if settings.tunMode}
                  <div class="hero-note">当前是「全局 TUN」模式，下面的应用分流规则不生效。到<button class="linkbtn" on:click={() => (tab = 'overview')}>概览</button>切回「应用分流」即可启用。</div>
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
              <div class="mode-explain">
                {#if ruleMode === 'whitelist'}
                  <b>只代理列出的</b>：只有下面标为「走代理」的程序走节点，其余程序（含没列出的）一律直连。<span class="mx-tag">日常推荐</span>
                {:else}
                  <b>默认全走代理</b>：整机所有程序默认走节点，只有下面标为「直连 / 拦截」的程序除外。
                {/if}
              </div>
            </section>

            <section class="card">
              <div class="card-head">
                <div><h3>应用规则</h3><p class="sub">共 {ruleCount} 条规则，其中 {proxyCount} 条走代理</p></div>
                <div class="actions">
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
                            <div class="app-icon" data-k={firstChar(p.desc || p.name)}>{firstChar(p.desc || p.name).toUpperCase()}</div>
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
                  <div class="rhead"><span>应用程序</span><span>分流方式</span><span class="ctr">启用</span><span class="ctr">操作</span></div>
                  {#each rules as r}
                    <div class="rrow" class:off={!r.enabled}>
                      <div class="app-cell">
                        {#if iconMap[r.path]}
                          <img class="app-icon-img" src={iconMap[r.path]} alt="" />
                        {:else}
                          <div class="app-icon" data-k={firstChar(ruleName(r))}>{firstChar(ruleName(r)).toUpperCase()}</div>
                        {/if}
                        <div class="app-meta"><strong>{ruleName(r)} <span class="run-dot" class:on={isRunning(r)} title={isRunning(r) ? '正在运行' : '未运行'}></span></strong><small class="path" title={r.path}>{r.path}</small></div>
                      </div>
                      <select class="line-select" bind:value={r.line} on:change={onRuleLineChange} title="规则=智能分流(大陆直连)·全局=全走节点·直连=不走代理·拦截=断网">
                        <option value="rule">规则</option>
                        <option value="global">全局</option>
                        <option value="direct">直连</option>
                        <option value="block">拦截</option>
                      </select>
                      <label class="switch ctr"><input type="checkbox" checked={r.enabled} on:change={() => toggleRule(r)} /><i></i></label>
                      <div class="row-actions ctr">
                        <button class="mini test" class:ok={(appLat[r.match] ?? -100) >= 0} class:err={appLat[r.match] === -1 || appLat[r.match] === -2} on:click={() => testApp(r)} title="测试此应用的连通与延迟">{latText(appLat[r.match])}</button>
                        <button class="icon-btn danger" on:click={() => removeRule(r)} title="删除规则">{@html I.trash}</button>
                      </div>
                    </div>
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
              <div class="card-head sm"><h3>节点延迟 / 速度</h3><button class="link" on:click={testAllLatency}>{@html I.refresh} 测延迟</button></div>
              <div class="nrail-head"><span>节点名称</span><span>延迟</span><span>下载速度</span></div>
              {#each (useDemo ? demoNodes : nodes).slice(0, 6) as n}
                <div class="nrail-row" class:sel={n.id === status?.selectedId} on:dblclick={() => selectNode(n.id)}>
                  <div class="nrail-name"><span class="flag {n.region || 'x'}"></span>{n.name}{#if n.id === status?.selectedId}<span class="active-badge">活动</span>{/if}</div>
                  <span class="lat" data-q={qual(n.latency)}>{n.latency ?? '—'} ms</span>
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

        <section class="card route-card">
          <div class="route-top">
            <div class="route-title">
              <h3>线路管理</h3>
              <p class="sub">每条线路 = 一个出口节点 + 一套分流策略。上面的应用规则里为每个应用挑选走哪条线路。总开关已并入顶部「流量走向」。</p>
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
                    {#each nodes as n}<option value={n.id}>{n.name}</option>{/each}
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

      {:else if tab === 'nodes'}
        <section class="card">
          <div class="card-head">
            <div><h3>节点</h3><p class="sub">导入、选择活动节点、测延迟与速度</p></div>
            <div class="actions">
              <button class="ghost-btn" on:click={testAllLatency}>{@html I.refresh} 测延迟</button>
              <button class="ghost-btn" on:click={runSpeedTest} disabled={speedTesting}>{@html I.gauge} {speedTesting ? '测速中…' : '测速'}</button>
              {#if speedMsg}<span class="speed-msg" class:err={speedMsg.indexOf('失败') === 0}>{speedMsg}</span>{/if}
              <button class="ghost-btn" on:click={() => (showManual = !showManual)}>{@html I.plus} 手动添加</button>
              <button class="primary" on:click={addNodes}>{@html I.plus} 从链接添加</button>
            </div>
          </div>
          <textarea bind:value={linkText} placeholder="粘贴分享链接，每行一个：vless:// vmess:// trojan:// ss:// socks:// http:// hysteria2:// tuic://"></textarea>
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
          <div class="toolbar"><input bind:value={query} placeholder="过滤别名 / 地址 / 类型" /></div>
          <div class="tscroll">
            <div class="ntable">
              <div class="nhead"><span>节点</span><span>延迟</span><span>速度</span><span class="ctr">操作</span></div>
              {#each nodes.filter((n) => !query || `${n.name}${n.server}${n.type}`.toLowerCase().includes(query.toLowerCase())) as n}
                <div class="nrow" class:sel={n.id === status?.selectedId} on:dblclick={() => selectNode(n.id)}>
                  <div class="ncell">
                    <span class="badge">{n.type}</span>
                    <div class="nmeta"><strong>{n.name}</strong><small class="muted">{n.server}:{n.port}</small></div>
                  </div>
                  <span class="lat" data-q={qual(n.latency)}>{n.latency ?? '—'} ms</span>
                  <span class="nspd">{n.speed?.toFixed(2) ?? '—'} MB/s</span>
                  <div class="row-actions ctr"><button class="mini" on:click={() => selectNode(n.id)}>设为活动</button><button class="icon-btn" on:click={() => showQR(n)} title="分享二维码">{@html I.qr}</button><button class="icon-btn danger" on:click={() => removeNode(n.id)} title="删除节点">{@html I.trash}</button></div>
                </div>
              {/each}
              {#if nodes.length === 0}<div class="empty">还没有节点。粘贴分享链接点「从链接添加」，或点「手动添加」填 SOCKS5 / HTTP 代理。</div>{/if}
            </div>
          </div>
        </section>

      {:else if tab === 'rules'}
        <section class="card page">
          <div class="card-head">
            <div><h3>分流规则库</h3><p class="sub">决定「哪些网站/IP 走代理、哪些直连」的地区规则(geosite / geoip)。「代理策略」选「规则」时,靠这套库判断大陆直连、境外走代理。</p></div>
            <div class="actions">
              <button class="primary" on:click={updateRuleSets} disabled={ruleSetMsg === '更新中…'}>{@html I.refresh} {ruleSetMsg === '更新中…' ? '更新中…' : '手动更新规则库'}</button>
              {#if ruleSetMsg && ruleSetMsg !== '更新中…'}<span class="rs-msg" class:err={ruleSetMsg.indexOf('失败') === 0}>{ruleSetMsg}</span>{/if}
            </div>
          </div>
          <div class="rs-list">
            <div class="rs-head"><span></span><span>规则库</span><span class="r">大小 / 更新日期</span></div>
            {#each ruleSets as rs}
              <div class="rs-row">
                <span class="lh-dot" class:ok={rs.present} class:bad={!rs.present}></span>
                <div class="rs-meta"><strong>{rs.display}</strong><small>{rs.desc}</small></div>
                <div class="rs-info r">{#if rs.present}<b>{rs.sizeKB} KB</b><small>更新于 {rs.modified}</small>{:else}<span class="rs-miss">缺失</span>{/if}</div>
              </div>
            {/each}
            {#if ruleSets.length === 0}<div class="empty sm">暂无规则库信息</div>{/if}
          </div>
          <div class="setting"><span>添加节点后自动更新规则库<small class="setting-hint">勾上后:每次加完节点自动更新一次。需代理运行中(规则库源在墙外,走节点下载)。默认关,手动更新更可控。</small></span><label class="switch"><input type="checkbox" bind:checked={settings.autoUpdateRules} on:change={saveSettings} /><i></i></label></div>
          <p class="rs-note">📦 规则库来自 sing-box 官方(SagerNet),已内置最新版。更新走<b>当前节点</b>下载(直连被墙),所以更新前请先「启动」并连上节点。</p>
        </section>

        <section class="card page">
          <div class="card-head">
            <div><h3>自定义规则</h3><p class="sub">你自己填的规则,<b>优先级最高</b>,盖过上面的国内外分流。「代理策略」为「规则」时生效。</p></div>
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

      {:else if tab === 'subs'}
        <section class="card page">
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
              <div class="sub-row">
                <div class="sub-meta"><strong>{s.name}</strong><small title={s.url}>{s.url}</small></div>
                <span class="sub-count">{s.nodeCount} 节点</span>
                <span class="muted">{s.lastUpdate || '手动'}</span>
                <div class="row-actions">
                  <span class="node-col">自动更新</span>
                  <label class="switch"><input type="checkbox" checked={s.autoUpdate} on:change={() => toggleSubAuto(s)} /><i></i></label>
                  {#if subMsg[s.id]}<span class="rs-msg" class:err={subMsg[s.id] === '失败'}>{subMsg[s.id]}</span>{/if}
                  <button class="mini" on:click={() => updateSub(s.id)} disabled={subMsg[s.id] === '更新中…'}>更新</button>
                  <button class="icon-btn danger" on:click={() => removeSub(s.id)} title="删除订阅">{@html I.trash}</button>
                </div>
              </div>
            {/each}
            {#if subs.length === 0}<div class="empty">还没有订阅，粘贴机场订阅链接添加</div>{/if}
          </div>
        </section>

      {:else if tab === 'logs'}
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
        <div class="settings-grid">
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
            <div class="setting"><span>对局域网开放<small class="setting-hint">手机/平板也能连本机代理（重启内核生效）</small></span><label class="switch"><input type="checkbox" bind:checked={settings.lanShare} on:change={saveSettings} /><i></i></label></div>
            {#if settings.lanShare}
              <div class="lan-cfg">
                <div class="lan-row">
                  <label class="lan-field"><span>端口</span><input type="number" min="1" max="65535" bind:value={settings.lanPort} on:change={saveSettings} /></label>
                  <label class="lan-field"><span>类型</span>
                    <select bind:value={settings.lanType} on:change={saveSettings}>
                      <option value="mixed">混合 (SOCKS5+HTTP)</option>
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
      <div class="sb-right">系统代理：<b class:on={sysProxy}>{sysProxy ? '已开启' : '已关闭'}</b><span class="ok" class:on={running}>✓</span></div>
    </footer>
  </section>

  {#if qrData}
    <div class="modal-mask" on:click={closeQR}>
      <div class="qr-modal" on:click|stopPropagation>
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

<style>
  :global(:root) {
    --bg: #eef1f6;
    --card: #ffffff;
    --soft: #f8fafc;
    --line: #e6eaf0;
    --line-2: #eef1f6;
    --line-3: #f1f5f9;
    --ink: #1e293b;
    --ink-2: #334155;
    --muted: #64748b;
    --muted-2: #94a3b8;
    --brand: #2563eb;
    --brand-600: #1d4ed8;
    --brand-tint: #eff4ff;
    --ok: #22c55e;
    --ok-600: #16a34a;
    --ok-tint: #f0fdf4;
    --danger: #ef4444;

    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 20px; --s6: 24px; --s7: 32px;
    --r1: 8px; --r2: 10px; --r3: 12px; --r4: 14px; --r5: 16px; --r6: 20px;

    --sh-1: 0 1px 2px rgba(15,23,42,.05), 0 1px 3px rgba(15,23,42,.04);
    --sh-2: 0 6px 16px -6px rgba(15,23,42,.14), 0 2px 6px -2px rgba(15,23,42,.06);
    --sh-float: 0 18px 40px -14px rgba(15,23,42,.28), 0 6px 14px -6px rgba(15,23,42,.14);
    --tr: .18s cubic-bezier(.4,0,.2,1);
    --side-w: 232px;
    --wrap-max: 1440px;
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

  /* ---------- overview page ---------- */
  .ov { display: grid; gap: var(--s4); }
  .firstrun { padding: 22px 24px; border: 1.5px solid color-mix(in srgb, var(--brand) 30%, var(--line)); }
  .fr-head h2 { font-size: 18px; font-weight: 760; color: var(--ink); }
  .fr-head p { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
  .fr-steps { display: grid; gap: 10px; margin-top: 16px; }
  .fr-step { display: flex; align-items: center; gap: 14px; background: var(--soft); border: 1px solid var(--line-2); border-radius: 12px; padding: 12px 16px; }
  .fr-n { width: 26px; height: 26px; flex: none; border-radius: 50%; background: var(--brand); color: #fff; font-weight: 800; font-size: 14px; display: grid; place-items: center; }
  .fr-txt { flex: 1; min-width: 0; } .fr-txt strong { font-size: 14px; color: var(--ink); } .fr-txt small { display: block; font-size: 12px; color: var(--muted); margin-top: 1px; }
  .ov-hero { padding: 22px 24px; }
  .ov-hero-main { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .ov-status { display: flex; align-items: center; gap: 14px; }
  .ov-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--muted-2); box-shadow: 0 0 0 4px var(--line-3); flex: none; }
  .ov-dot.on { background: var(--ok); box-shadow: 0 0 0 4px var(--ok-tint); }
  .ov-status h2 { font-size: 20px; font-weight: 750; color: var(--ink); }
  .ov-status p { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
  .ov-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 20px; }
  .ov-stat { background: var(--soft); border: 1px solid var(--line-2); border-radius: 12px; padding: 12px 14px; }
  .ov-stat small { display: block; font-size: 11.5px; color: var(--muted-2); font-weight: 600; }
  .ov-stat b { font-size: 22px; font-weight: 770; color: var(--ink); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .ov-stat em { font-style: normal; font-size: 11px; color: var(--muted); margin-left: 3px; }
  .ov-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s4); }
  .mode-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .mc { text-align: left; border: 1.5px solid var(--line); background: var(--soft); border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: all var(--tr); font-family: inherit; }
  .mc:hover { border-color: var(--brand); }
  .mc.on { border-color: var(--brand); background: var(--brand-tint); }
  .mc strong { display: block; font-size: 14px; color: var(--ink); font-weight: 700; margin-bottom: 3px; }
  .mc.on strong { color: var(--brand-600); }
  .mc small { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
  .mc:disabled { opacity: .55; cursor: default; }
  .ov-node { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
  .ov-node .grow { flex: 1; min-width: 0; }
  .ov-node .grow strong { font-size: 14px; color: var(--ink); }
  .ov-node .grow small { display: block; color: var(--muted-2); font-size: 12px; }
  .power-btn.lg { height: 48px; padding: 0 26px; font-size: 15px; }
  .mode-seg.lg { height: 42px; } .mode-seg.lg button { font-size: 14px; padding: 0 18px; }
  .mode-seg.full { display: flex; } .mode-seg.full button { flex: 1; }
  .mode-seg.sm { height: 30px; align-self: center; } .mode-seg.sm button { font-size: 12px; padding: 0 10px; }
  .sel { border: 1px solid var(--line); background: var(--soft); color: var(--ink-2); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer; }
  .mode-explain { font-size: 13px; color: var(--ink-2); background: var(--soft); border: 1px solid var(--line-2); border-radius: 10px; padding: 11px 14px; line-height: 1.55; margin-top: 4px; }
  .mode-explain b { color: var(--brand-600); }
  .mx-tag { display: inline-block; margin-left: 6px; font-size: 11px; font-weight: 700; color: var(--ok-600); background: var(--ok-tint); padding: 1px 8px; border-radius: 6px; }
  .opt-tag { font-size: 10.5px; font-weight: 700; color: var(--muted); background: var(--surface-3, #eef2f8); padding: 1px 7px; border-radius: 6px; vertical-align: middle; margin-left: 4px; }

  /* prominent warning banner */
  .warnbar { display: flex; align-items: center; gap: 12px; padding: 12px 22px; background: var(--bad-bg, #fdecec); border-bottom: 2px solid var(--danger); color: var(--danger); font-size: 13.5px; flex: none; }
  .warnbar-ic { font-size: 18px; flex: none; }
  .warnbar-txt { flex: 1; line-height: 1.45; } .warnbar-txt strong { font-weight: 780; }
  .warnbar-x { background: none; border: none; color: var(--danger); cursor: pointer; font-size: 15px; opacity: .7; padding: 4px; flex: none; }
  .warnbar-x:hover { opacity: 1; }

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
  .rs-head, .rs-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) 150px; gap: 12px; align-items: center; }
  .rs-head { font-size: 11px; color: var(--muted-2); font-weight: 600; padding: 0 2px 10px; border-bottom: 1px solid var(--line-2); }
  .rs-head .r { text-align: right; }
  .rs-row { padding: 12px 2px; border-bottom: 1px solid var(--line-3); }
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
  .mini.test { min-width: 52px; padding: 5px 8px; font-variant-numeric: tabular-nums; background: var(--surface-3, #eef2f8); color: var(--muted); }
  .mini.test.ok { background: var(--ok-tint); color: var(--ok-600); }
  .mini.test.err { background: var(--bad-bg, #fdecec); color: var(--danger); }
  .mini.pick { background: var(--brand-tint); color: var(--brand-600); }
  .mini.pick :global(svg) { width: 14px; height: 14px; }
  .pick-hint { margin: 8px 2px 0; font-size: 11.5px; color: var(--muted-2); }
  .cfg-io { display: inline-flex; gap: 6px; }
  .cfg-io :global(svg) { width: 13px; height: 13px; }

  /* LAN-share sub-form */
  .lan-cfg { padding: 12px 0 6px; border-bottom: 1px solid var(--line-3); display: grid; gap: 10px; min-width: 0; }
  .lan-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
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
  .sidebar { background: var(--card); border-right: 1px solid var(--line); padding: var(--s5) var(--s4); display: flex; flex-direction: column; min-width: 0; }
  .brand { display: flex; align-items: center; gap: 11px; padding: 2px 6px 26px; }
  .logo { width: 34px; height: 34px; border-radius: var(--r2); display: grid; place-items: center; font-size: 20px; color: #fff; background: linear-gradient(135deg, #3b82f6, #6366f1); box-shadow: 0 6px 16px -6px rgba(59,130,246,.6); }
  .brand-title { font-size: 18px; font-weight: 800; color: var(--ink); letter-spacing: -.01em; }
  .side-nav { display: grid; gap: 4px; }
  .side-nav button { height: 44px; border-radius: 11px; padding: 0 13px; display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 14.5px; }
  .side-nav button i { font-size: 20px; color: var(--muted-2); transition: color var(--tr); }
  .side-nav button span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .side-nav button:hover { background: var(--line-3); color: var(--ink-2); }
  .side-nav button.active { background: var(--brand-tint); color: var(--brand); font-weight: 650; }
  .side-nav button.active i { color: var(--brand); }
  .sidebar-foot { margin-top: auto; display: grid; gap: var(--s4); }
  .core-card { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border: 1px solid var(--line); border-radius: var(--r3); background: var(--soft); min-width: 0; }
  .core-card strong { display: block; font-size: 13px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .core-card small { display: block; font-size: 11px; color: var(--muted-2); margin-top: 2px; }
  .dot { width: 9px; height: 9px; flex: none; border-radius: 50%; background: #cbd5e1; transition: background var(--tr), box-shadow var(--tr); }
  .dot.on { background: var(--ok); box-shadow: 0 0 0 4px rgba(34,197,94,.14); }
  .foot-icons { display: flex; gap: 8px; padding-left: 2px; }
  .foot-icons button { width: 34px; height: 34px; border-radius: 9px; color: var(--muted-2); font-size: 18px; display: grid; place-items: center; }
  .foot-icons button:hover { background: var(--line-3); color: var(--ink-2); }

  /* ---------- workspace ---------- */
  .workspace { min-width: 0; display: flex; flex-direction: column; height: 100vh; }
  .topbar { min-height: 68px; flex: none; display: flex; align-items: center; justify-content: space-between; gap: var(--s3) var(--s4); flex-wrap: wrap;
    padding: 10px 22px; background: var(--card); border-bottom: 1px solid var(--line); }
  .tb-left { display: flex; align-items: flex-end; gap: var(--s3); flex-wrap: wrap; min-width: 0; }
  .tb-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .tb-field label { font-size: 11px; color: var(--muted-2); display: flex; align-items: center; gap: 5px; font-weight: 600; letter-spacing: .01em; }
  .node-dot { width: 7px; height: 7px; border-radius: 50%; background: #cbd5e1; transition: background var(--tr); }
  .node-dot.on { background: var(--ok); }
  .tb-field select { height: 34px; max-width: 240px; border: 1px solid #e2e8f0; border-radius: 9px; background: var(--soft); padding: 0 28px 0 12px; font-size: 13px; font-weight: 600; color: var(--ink-2);
    appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 9px center; transition: border-color var(--tr), box-shadow var(--tr); }
  .tb-field select:hover { border-color: #cbd5e1; }
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
  .mode-seg button { padding: 0 12px; border-radius: 999px; font-size: 12.5px; font-weight: 650; color: var(--muted); background: transparent; border: none; cursor: pointer; transition: all var(--tr); }
  .mode-seg button:hover { color: var(--ink-2); }
  .mode-seg button.on { background: var(--card); color: var(--brand-600); box-shadow: 0 1px 2px rgba(15,23,42,.12); }

  .speed-msg { align-self: center; font-size: 12.5px; font-weight: 600; color: var(--ok-600); }
  .speed-msg.err { color: #dc2626; }

  .tb-right { display: flex; align-items: center; gap: var(--s3) var(--s4); flex-wrap: wrap; justify-content: flex-end; }
  .metric { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); white-space: nowrap; }
  .metric b { font-size: 15px; color: var(--ink); font-weight: 750; font-variant-numeric: tabular-nums; }
  .metric .mi { font-size: 17px; }
  .mi.down { color: #3b82f6; } .mi.up { color: var(--ok); }
  .metric.col { gap: 8px; } .metric.col .mi { color: var(--muted-2); }
  .metric.col small, .conn small { display: block; font-size: 10.5px; color: var(--muted-2); }
  .metric.col b, .conn b { font-size: 14px; }
  .conn { display: flex; align-items: center; gap: 8px; color: var(--muted-2); white-space: nowrap; }
  .conn.on { color: var(--ok-600); } .conn.on b { color: var(--ok-600); } .conn .mi { font-size: 18px; }
  .conn b { font-variant-numeric: tabular-nums; }
  .power-btn { display: flex; align-items: center; gap: 7px; height: 40px; padding: 0 18px; border-radius: var(--r2); font-weight: 750; font-size: 14px;
    color: #fff; background: var(--ok); box-shadow: 0 8px 18px -6px rgba(34,197,94,.5); }
  .power-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 22px -8px rgba(34,197,94,.55); }
  .power-btn:active { transform: translateY(0); }
  .power-btn :global(svg) { width: 18px; height: 18px; }
  .power-btn:not(.running) { background: var(--brand); box-shadow: 0 8px 18px -6px rgba(37,99,235,.5); }
  .power-btn:not(.running):hover { box-shadow: 0 12px 22px -8px rgba(37,99,235,.55); }

  /* ---------- scroll area + columns ---------- */
  .scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: var(--s5); }
  .wrap { max-width: var(--wrap-max); margin: 0 auto; display: grid; gap: var(--s5); }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--s5); align-items: start; }
  .col-main { display: grid; gap: var(--s5); min-width: 0; }
  .col-rail { display: grid; gap: var(--s5); min-width: 0; }

  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r5); padding: var(--s5); box-shadow: var(--sh-1); transition: box-shadow var(--tr), border-color var(--tr); }
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
  .primary, .ghost-btn, .mini, .link, .rail-more, .icon-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 9px; font-size: 13px; }
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
  .rtable { display: grid; gap: 2px; min-width: 500px; }
  .rhead, .rrow { display: grid; grid-template-columns: minmax(0, 2fr) minmax(110px, 1.1fr) 58px 108px; gap: 12px; align-items: center; }
  .rhead { padding: 0 6px 10px; font-size: 11.5px; color: var(--muted-2); border-bottom: 1px solid var(--line-2); font-weight: 600; letter-spacing: .02em; }
  .ctr { text-align: center; justify-content: center; }
  .rrow { padding: 11px 6px; border-bottom: 1px solid var(--line-3); border-radius: 8px; transition: background var(--tr); }
  .rrow:hover { background: var(--soft); }
  .rrow.off { opacity: .55; }
  .app-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .app-meta { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .app-icon { width: 32px; height: 32px; flex: none; border-radius: 9px; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: #fff; background: #64748b; }
  .app-icon[data-k="C"] { background: var(--brand); } .app-icon[data-k="c"] { background: var(--ok); }
  .app-icon[data-k="T"] { background: #38bdf8; } .app-icon[data-k="m"] { background: #14b8a6; } .app-icon[data-k="S"] { background: #1e293b; }
  .app-icon-img { width: 32px; height: 32px; flex: none; border-radius: 9px; object-fit: contain; }
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
  .switch.lg { width: 52px; height: 30px; }
  .switch.lg i:before { width: 24px; height: 24px; }
  .switch.lg input:checked + i { background: var(--ok); }
  .switch.lg input:checked + i:before { transform: translateX(22px); }

  .rfoot { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; margin-top: var(--s4); padding-top: var(--s4); border-top: 1px solid var(--line-2); }
  .modes { display: flex; align-items: center; gap: 8px 18px; font-size: 13px; color: var(--muted); flex-wrap: wrap; }
  .modes-k { color: var(--muted-2); font-weight: 600; }
  .modes label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .modes input { accent-color: var(--brand); }
  .dl-field span { color: var(--muted-2); font-weight: 600; }
  .dl-field select { border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 26px 6px 9px; background: var(--soft); font-size: 12.5px; font-weight: 600; color: var(--ink-2);
    appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; }
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
  .mini { background: var(--brand-tint); color: var(--brand); padding: 8px 13px; font-size: 12.5px; font-weight: 600; }
  .mini.danger { background: var(--bad-bg, #fdecec); color: var(--danger); }
  .mini:hover { background: #e0e7ff; }
  .grow { flex: 1 1 180px; min-width: 0; }

  /* ---------- right rail ---------- */
  .nrail-head { display: grid; grid-template-columns: minmax(0, 1fr) 62px 104px; gap: 8px; font-size: 11px; color: var(--muted-2); padding: 0 2px 8px; font-weight: 600; letter-spacing: .02em; }
  .nrail-row { display: grid; grid-template-columns: minmax(0, 1fr) 62px 104px; gap: 8px; align-items: center; padding: 9px 6px; border-radius: 9px; cursor: pointer; transition: background var(--tr); }
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
  .toolbar { margin: 12px 0; } .toolbar input { width: 100%; }
  .toast { color: var(--ok-600); font-size: 13px; margin-top: 8px; }
  .ntable { display: grid; gap: 2px; min-width: 500px; }
  .nhead, .nrow { display: grid; grid-template-columns: minmax(0, 2fr) 90px 108px auto; gap: 12px; align-items: center; }
  .nhead { font-size: 11.5px; color: var(--muted-2); padding: 0 8px 10px; border-bottom: 1px solid var(--line-2); font-weight: 600; letter-spacing: .02em; }
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
  .rm-text strong { font-size: 13.5px; color: var(--ink); }
  .rm-text small { font-size: 11.5px; color: var(--muted); }
  .route-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: var(--s4); }
  .rs-msg { font-size: 12.5px; font-weight: 650; color: var(--ok-600); }
  .rs-msg.err { color: var(--danger); }
  .rs-hint { font-size: 12px; color: var(--muted-2); }
  .route-rules { display: grid; gap: 8px; margin-top: 14px; }
  .route-rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .route-rule select { flex: 0 1 auto; min-width: 118px; border: 1px solid #e2e8f0; border-radius: 9px; padding: 8px 10px; background: var(--soft); font-size: 13px; color: var(--ink-2); }
  .route-rule input { flex: 1 1 200px; min-width: 0; padding: 8px 11px; }

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
  .setting:last-child { border-bottom: 0; } .setting strong { color: var(--ink); text-align: right; }
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

  /* ---------- bottom status bar ---------- */
  .statusbar { min-height: 40px; flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; padding: 6px 22px; background: var(--card); border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
  .sb-k { color: var(--muted-2); } .sep { color: #cbd5e1; margin: 0 6px; }
  .sb-mode { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); background: var(--surface, var(--card)); color: var(--muted); border-radius: 7px; padding: 3px 9px; font-size: 12.5px; font-family: inherit; cursor: pointer; transition: all var(--tr); }
  .sb-mode:hover { border-color: var(--brand); color: var(--brand-600); }
  .sb-mode b { color: var(--ink-2); font-weight: 700; } .sb-mode:hover b { color: var(--brand-600); }
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
    .core-card { justify-content: center; padding: 11px 0; }
  }
  @media (max-width: 620px) {
    .scroll { padding: var(--s3); }
    .card { padding: var(--s4); }
    .tscroll { margin: 0; padding: 0; }
    .power-btn span { display: inline; }
    .route-master { flex: 1 1 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
  }
</style>
