// 连接图的数据模型：把内核的实时连接（Conn）聚合成三列图——本机程序 → 走哪条路（直连 / 某个节点 / 拦截）→ 访问的网站。
// 纯函数，概览的小图和「连接」页的大画布共用。
import type { Conn } from "../../api/types";

export type Lane = "app" | "route" | "site";
export type RouteKind = "direct" | "proxy" | "block";

export type FlowNode = {
  id: string;
  lane: Lane;
  label: string;
  /** 程序：完整路径；网站：host；路线：出站标签 */
  detail: string;
  kind?: RouteKind;
  conns: number;
  bytes: number;
  /** 程序节点：折叠时它的网站合成一个「N 个网站」节点 */
  collapsedSites?: number;
};

export type FlowEdge = { id: string; from: string; to: string; conns: number; bytes: number; kind: RouteKind };

export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; totalConns: number };

export function routeKind(c: Conn): RouteKind {
  if (c.outTag === "direct") return "direct";
  if (c.outTag === "reject" || c.outTag === "block") return "block";
  return "proxy";
}

function routeLabel(c: Conn, kind: RouteKind): string {
  if (kind === "direct") return "直连（国内 / 本地）";
  if (kind === "block") return "拦截";
  return c.outbound || c.outTag || "代理";
}

/** 网站名去掉端口，过长的子域只留后面三段（看得出是哪家服务）。 */
export function siteName(host: string): string {
  const h = host.replace(/^\[|\](:\d+)?$/g, "").replace(/:\d+$/, "");
  if (/^\d+(\.\d+){3}$/.test(h) || h.includes(":")) return h;
  const parts = h.split(".");
  return parts.length > 3 ? parts.slice(-3).join(".") : h;
}

function appName(c: Conn): string {
  return (c.process || "未知程序").replace(/\.exe$/i, "");
}

type Opts = {
  /** 每列最多显示几个，多出来的合成「其他」 */
  maxApps?: number;
  maxSites?: number;
  /** 展开了哪些程序（只有展开的程序才画出它访问的网站；undefined = 全部展开） */
  expanded?: Set<string>;
};

function bump<T extends { conns: number; bytes: number }>(m: Map<string, T>, key: string, make: () => T, b: number) {
  let v = m.get(key);
  if (!v) {
    v = make();
    m.set(key, v);
  }
  v.conns += 1;
  v.bytes += b;
  return v;
}

type Graph = { nodes: Map<string, FlowNode>; edges: Map<string, FlowEdge> };
type Keep = { apps: Set<string>; sites: Set<string>; expanded?: Set<string> };

/** 按出现次数取前 n 个 */
function topKeys(values: string[], n?: number): Set<string> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  const keys = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return new Set(keys.slice(0, n ?? keys.length));
}

function node(g: Graph, id: string, make: () => FlowNode, b: number) {
  bump(g.nodes, id, make, b);
}

function edge(g: Graph, from: string, to: string, kind: RouteKind, b: number) {
  const id = `${from}>${to}`;
  bump(g.edges, id, () => ({ id, from, to, conns: 0, bytes: 0, kind }), b);
}

/** 一条连接加进图：程序 → 路线 → 网站（程序折叠时网站合成一个节点）。 */
function addConn(g: Graph, c: Conn, keep: Keep) {
  const b = (c.upload || 0) + (c.download || 0);
  const kind = routeKind(c);
  const an = appName(c);
  const app = keep.apps.has(an) ? an : "其他程序";
  const appId = `a:${app}`;
  const routeId = `r:${kind === "proxy" ? c.outTag || "proxy" : kind}`;
  const rawSite = siteName(c.host || c.dest);
  node(g, appId, () => ({ id: appId, lane: "app", label: app, detail: c.path || c.process, conns: 0, bytes: 0 }), b);
  node(
    g,
    routeId,
    () => ({ id: routeId, lane: "route", label: routeLabel(c, kind), detail: c.outTag, kind, conns: 0, bytes: 0 }),
    b,
  );
  edge(g, appId, routeId, kind, b);
  const open = !keep.expanded || keep.expanded.has(appId);
  const site = open ? (keep.sites.has(rawSite) ? rawSite : "其他网站") : `${app} 的网站`;
  const siteId = open ? `s:${site}` : `s:*${app}`;
  const detail = open ? rawSite : "点左边的程序展开";
  node(g, siteId, () => ({ id: siteId, lane: "site", label: site, detail, conns: 0, bytes: 0 }), b);
  edge(g, routeId, siteId, kind, b);
}

/** 折叠的网站节点改名为「N 个网站」 */
function labelCollapsed(g: Graph, conns: Conn[], keep: Keep) {
  if (!keep.expanded) return;
  const perApp = new Map<string, Set<string>>();
  for (const c of conns) {
    const an = keep.apps.has(appName(c)) ? appName(c) : "其他程序";
    if (keep.expanded.has(`a:${an}`)) continue;
    const set = perApp.get(an) ?? new Set<string>();
    set.add(siteName(c.host || c.dest));
    perApp.set(an, set);
  }
  for (const [an, set] of perApp) {
    const n = g.nodes.get(`s:*${an}`);
    if (!n) continue;
    n.collapsedSites = set.size;
    n.label = `${set.size} 个网站`;
  }
}

/** 把连接聚合成三列图。 */
export function buildFlowGraph(conns: Conn[], opts: Opts = {}): FlowGraph {
  const g: Graph = { nodes: new Map(), edges: new Map() };
  const keep: Keep = {
    apps: topKeys(conns.map(appName), opts.maxApps),
    sites: topKeys(
      conns.map((c) => siteName(c.host || c.dest)),
      opts.maxSites,
    ),
    expanded: opts.expanded,
  };
  for (const c of conns) addConn(g, c, keep);
  labelCollapsed(g, conns, keep);
  const sorted = [...g.nodes.values()].sort((a, b) => b.conns - a.conns);
  return { nodes: sorted, edges: [...g.edges.values()], totalConns: conns.length };
}
