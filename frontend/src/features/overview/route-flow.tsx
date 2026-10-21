// 分流链路：应用程序 → 分流规则 → 代理核心 → 活动节点。运行中沿链路流动，停止时断开。
import { Panel, StatusBadge } from "@ankotti/admin-ui";
import { FlowBeams } from "@ankotti/admin-ui/motion";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { isRunning, runtime } from "../../state/runtime";

const W = 720;
const H = 72;

function captureBadge(health: { running: boolean; warning: string; capturing: boolean }) {
  if (!health.running) return <StatusBadge tone="neutral">未运行</StatusBadge>;
  if (health.warning) return <StatusBadge tone="danger">分流异常</StatusBadge>;
  if (health.capturing) return <StatusBadge tone="success">分流运行中</StatusBadge>;
  return <StatusBadge tone="info">等待流量…</StatusBadge>;
}

export function RouteFlow() {
  const health = useStore(runtime, (s) => s.health);
  const status = useStore(runtime, (s) => s.status);
  const coreVersion = useStore(runtime, (s) => s.coreVersion);
  const ruleCount = useStore(data, (s) => s.rules.length);
  const ruleMode = useStore(data, (s) => s.ruleMode);
  const nodes = useStore(data, (s) => s.nodes);
  const running = isRunning(status);
  const active = nodes.find((n) => n.id === status?.selectedId);
  const labels = [
    `应用程序 · ${ruleCount} 条`,
    ruleMode === "whitelist" ? "规则 · 只代理列出的" : "规则 · 默认全代理",
    `sing-box ${coreVersion || "—"}`,
    active?.name ?? "未选择节点",
  ];
  const step = W / labels.length;
  const flowNodes = labels.map((label, i) => ({ id: String(i), label, x: step * i + step / 2, y: H / 2 }));
  const state = !running ? "down" : health.warning ? "slow" : "ok";
  const edges = flowNodes.slice(1).map((n, i) => ({ from: String(i), to: n.id, state }) as const);
  return (
    <Panel title="分流链路" description="从应用到目标节点的实时路径。" actions={captureBadge(health)}>
      <FlowBeams label="分流链路" width={W} height={H} nodes={flowNodes} edges={edges} />
    </Panel>
  );
}
