// 端口代理的纯逻辑：新建默认值、校验、批量计划、地址文案。无副作用，单测覆盖（port-draft.test.ts）。
import type { PortMode, PortProtocol, ProxyPort } from "../../api/types";

export const PORT_MIN = 1;
export const PORT_MAX = 65535;
export const BATCH_MAX = 50;
export const FIRST_PORT = 10801;

export const PROTOCOL_LABEL: Record<PortProtocol, string> = {
  mixed: "SOCKS5 + HTTP",
  socks: "SOCKS5",
  http: "HTTP",
};

export const PROTOCOL_OPTIONS = (Object.keys(PROTOCOL_LABEL) as PortProtocol[]).map((value) => ({
  value,
  label: PROTOCOL_LABEL[value],
}));

export const MODE_OPTIONS: { value: PortMode; label: string }[] = [
  { value: "rule", label: "规则" },
  { value: "global", label: "全局" },
  { value: "direct", label: "直连" },
];

export const MODE_HINT: Record<PortMode, string> = {
  rule: "智能分流：大陆直连，其余走节点",
  global: "全部走节点",
  direct: "全部直连，不走代理",
};

/** 从 from 起第一个没被占用的端口。 */
export function nextFreePort(used: readonly number[], from = FIRST_PORT): number {
  const taken = new Set(used);
  let p = from;
  while (taken.has(p) && p < PORT_MAX) p++;
  return p;
}

/** 新建端口的默认值：接着已有最大端口往后排，名字「浏览器N」。 */
export function emptyPort(existing: readonly Pick<ProxyPort, "port">[]): ProxyPort {
  const ports = existing.map((p) => p.port);
  const next = ports.length ? nextFreePort(ports, Math.max(...ports) + 1) : FIRST_PORT;
  return {
    id: "",
    name: `浏览器${existing.length + 1}`,
    enabled: true,
    port: Math.min(next, PORT_MAX),
    protocol: "mixed",
    lan: false,
    user: "",
    pass: "",
    mode: "rule",
    node: "",
  };
}

/** 客户端先挡明显的错误；端口冲突、被系统占用等由后端判断。 */
export function validatePort(p: Pick<ProxyPort, "name" | "port">): string {
  if (!p.name.trim()) return "请填写端口名称";
  if (!Number.isInteger(p.port) || p.port < PORT_MIN || p.port > PORT_MAX) return "端口要在 1 – 65535 之间";
  return "";
}

export type BatchPlan = { prefix: string; start: number; count: number };

export function validateBatch(plan: BatchPlan, used: readonly number[]): string {
  const { start, count } = plan;
  if (!Number.isInteger(start) || start < PORT_MIN || start > PORT_MAX) return "起始端口要在 1 – 65535 之间";
  if (!Number.isInteger(count) || count < 1 || count > BATCH_MAX) return `数量要在 1 – ${BATCH_MAX} 之间`;
  if (start + count - 1 > PORT_MAX) return "端口超出 65535，请减少数量或调小起始端口";
  const taken = new Set(used);
  for (let p = start; p < start + count; p++) {
    if (taken.has(p)) return `端口 ${p} 已被其它端口代理占用`;
  }
  return "";
}

/** 同一套设置批量展开：端口从 start 递增，名称「前缀1 … 前缀N」。 */
export function batchDrafts(base: ProxyPort, plan: BatchPlan): ProxyPort[] {
  const prefix = plan.prefix.trim() || "浏览器";
  return Array.from({ length: plan.count }, (_, i) => ({
    ...base,
    id: "",
    enabled: true,
    name: `${prefix}${i + 1}`,
    port: plan.start + i,
  }));
}

/** 端口监听地址：局域网可连 0.0.0.0，否则只听 127.0.0.1。 */
export function listenAddress(p: Pick<ProxyPort, "lan" | "port">): string {
  return `${p.lan ? "0.0.0.0" : "127.0.0.1"}:${p.port}`;
}

/** 给别的设备填的地址：局域网可连时用本机局域网 IP，否则 127.0.0.1。 */
export function connectAddress(p: Pick<ProxyPort, "lan" | "port">, lanIP: string): string {
  return `${p.lan && lanIP ? lanIP : "127.0.0.1"}:${p.port}`;
}
