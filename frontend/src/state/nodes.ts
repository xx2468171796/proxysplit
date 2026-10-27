// 节点：导入、手动添加、删除、测 TCP / Google / 下载速度、分享二维码。
import { api } from "../api/backend";
import type { Node } from "../api/types";
import { createStore } from "../shared/store";
import { data, refreshNodes } from "./data";
import { refreshStatus } from "./runtime";

/** 正在测试的节点（同一种测试同时只跑一个）。 */
export type NodeTestState = {
  allLatency: boolean;
  googleId: string;
  tcpId: string;
  speedId: string;
  activeSpeed: boolean;
};

export const nodeTests = createStore<NodeTestState>({
  allLatency: false,
  googleId: "",
  tcpId: "",
  speedId: "",
  activeSpeed: false,
});

const markNodes = (match: (n: Node) => boolean, patch: Partial<Node>) =>
  data.set((s) => ({ nodes: s.nodes.map((n) => (match(n) ? { ...n, ...patch } : n)) }));

export function nodeName(id: string, nodes: Node[]): string {
  return nodes.find((n) => n.id === id)?.name || id;
}

/** 线路出口：active 跟随活动节点 / direct 直连 / 节点 id。 */
export function lineNodeLabel(node: string, nodes: Node[]): string {
  if (node === "active") return "跟随活动节点";
  if (node === "direct") return "直连";
  return nodeName(node, nodes);
}

export async function addNodes(links: string): Promise<string> {
  const r = await api.addNodes(links).catch(() => ({ added: 0, skipped: 0 }));
  await Promise.all([refreshNodes(), refreshStatus()]);
  return `已添加 ${r?.added ?? 0} 个，跳过 ${r?.skipped ?? 0} 个`;
}

export type ManualNode = {
  type: string;
  name: string;
  server: string;
  port: number;
  username: string;
  password: string;
};

export async function addManualNode(m: ManualNode): Promise<string> {
  if (!m.server.trim() || !m.port) return "请填写地址和端口";
  const err = await api.addManualNode(m.type, m.name, m.server.trim(), Number(m.port), m.username, m.password);
  if (!err) await Promise.all([refreshNodes(), refreshStatus()]);
  return err;
}

export async function removeNode(id: string): Promise<string> {
  const err = await api.removeNode(id);
  await Promise.all([refreshNodes(), refreshStatus()]);
  return err;
}

/** 批量删除（一次保存、内核只重启一次）。 */
export async function removeNodes(ids: string[]): Promise<string> {
  const err = await api.removeNodes(ids);
  await Promise.all([refreshNodes(), refreshStatus()]);
  return err;
}

async function runTest(key: "googleId" | "tcpId" | "speedId", id: string, call: () => Promise<unknown>) {
  if (nodeTests.get()[key]) return "";
  nodeTests.set({ [key]: id });
  try {
    await call();
    return "";
  } catch (e) {
    return String(e);
  } finally {
    await refreshNodes();
    nodeTests.set({ [key]: "" });
  }
}

export async function testAllLatency(): Promise<string> {
  if (nodeTests.get().allLatency) return "";
  nodeTests.set({ allLatency: true });
  markNodes(() => true, { latency: -99, tcpLatency: -99 });
  try {
    await api.testAllLatency();
    return "";
  } catch (e) {
    return `Google 连通性检测失败：${String(e)}`;
  } finally {
    await refreshNodes();
    nodeTests.set({ allLatency: false });
  }
}

export async function testGoogle(id: string): Promise<string> {
  if (nodeTests.get().googleId) return "";
  markNodes((n) => n.id === id, { latency: -99, tcpLatency: -99 });
  const err = await runTest("googleId", id, () => api.testLatency(id));
  return err && `Google 连通性检测失败：${err}`;
}

export async function testTCP(id: string): Promise<string> {
  if (nodeTests.get().tcpId) return "";
  markNodes((n) => n.id === id, { tcpLatency: -99 });
  const err = await runTest("tcpId", id, () => api.testTCP(id));
  return err && `TCP 连通性检测失败：${err}`;
}

export async function testSpeed(id: string): Promise<string> {
  let msg = "";
  const err = await runTest("speedId", id, async () => {
    const r = await api.speedTestNode(id);
    if (r?.err) msg = `测速失败：${r.err}`;
  });
  return err ? `测速失败：${err}` : msg;
}

/** 测活动节点下载速度，返回给用户看的结果。 */
export async function testActiveSpeed(): Promise<string> {
  if (nodeTests.get().activeSpeed) return "";
  nodeTests.set({ activeSpeed: true });
  try {
    const r = await api.speedTest();
    if (r?.err) return `测速失败：${r.err}`;
    await refreshNodes();
    return `活动节点下载速度 ${(r?.mbps ?? 0).toFixed(2)} MB/s`;
  } catch (e) {
    return `测速失败：${String(e)}`;
  } finally {
    nodeTests.set({ activeSpeed: false });
  }
}

/** 节点分享：分享链接 + 二维码；POWER云 官方线路后端会拒绝。 */
export async function nodeShare(id: string): Promise<{ link?: string; qr?: string; err?: string }> {
  const r = await api.nodeShare(id);
  return r?.err ? { err: r.err } : { link: r?.link || "", qr: r?.qr || "" };
}

/** 改节点内核（'' 自动 / 'sing-box' / 'xray'）；节点在用时后端会重启内核。返回 '' = 成功。 */
export async function setNodeCore(id: string, core: string): Promise<string> {
  const err = await api.setNodeCore(id, core).catch((e: unknown) => String(e));
  await Promise.all([refreshNodes(), refreshStatus()]);
  return err;
}

/** 设前置代理（"" = 取消）；代理在跑时后端会重启内核。返回 '' = 成功。 */
export async function setNodeVia(id: string, via: string): Promise<string> {
  const err = await api.setNodeVia(id, via).catch((e: unknown) => String(e));
  await Promise.all([refreshNodes(), refreshStatus()]);
  return err;
}
