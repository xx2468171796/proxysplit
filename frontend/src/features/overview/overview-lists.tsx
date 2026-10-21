// 概览里的三个小列表：应用流量（前 4 条规则）、节点健康（前 4 个节点）、最新日志。
import { ActionList, Button, CellText, type Column, DataTable, Panel, StatusBadge, Tag } from "@ankotti/admin-ui";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { AppRule, Node } from "../../api/types";
import { navigate } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { RuleIcon } from "../../components/app-icon";
import { latencyGrade, latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { ruleName } from "../../state/app-rules";
import { data, selectNode } from "../../state/data";
import { lineNodeLabel, nodeName } from "../../state/nodes";
import { customLineOf, lineLabel } from "../../state/routing";
import { runtime } from "../../state/runtime";

export function AppTraffic() {
  const rules = useStore(data, (s) => s.rules);
  const lines = useStore(data, (s) => s.lines);
  const nodes = useStore(data, (s) => s.nodes);
  const routeNode = (r: AppRule): string => {
    const custom = customLineOf(r.line, lines);
    if (custom) return lineNodeLabel(custom.node, nodes);
    if (r.line === "direct" || r.line === "block") return "—";
    return r.node ? nodeName(r.node, nodes) : "活动节点";
  };
  const columns: Column<AppRule>[] = [
    {
      key: "app",
      title: "应用",
      render: (r) => (
        <span className="ps-app-cell">
          <RuleIcon rule={r} />
          <CellText primary={ruleName(r)} secondary={r.path} />
        </span>
      ),
    },
    { key: "line", title: "策略", width: 110, render: (r) => <Tag>{lineLabel(r.line, lines)}</Tag> },
    {
      key: "node",
      title: "节点",
      width: 180,
      truncate: (r) => routeNode(r),
      render: (r) => routeNode(r),
    },
    {
      key: "state",
      title: "状态",
      width: 96,
      mobile: "status",
      render: (r) => (
        <StatusBadge variant="dot" tone={r.enabled ? "success" : "neutral"}>
          {r.enabled ? "已启用" : "已停用"}
        </StatusBadge>
      ),
    },
  ];
  return (
    <Panel
      title="应用流量"
      description="最近添加的应用规则与分流状态。"
      actions={
        <Button size="sm" variant="outline" onClick={() => navigate("apps")}>
          管理应用
        </Button>
      }
      flush
    >
      <DataTable
        caption="应用流量"
        rows={rules.slice(0, 4)}
        rowKey={(r) => r.match}
        columns={columns}
        pagination={{ mode: "all" }}
        emptyLabel="暂无应用规则"
      />
    </Panel>
  );
}

const GRADE_TONE = ["danger", "warning", "warning", "success", "success"] as const;

export function NodeHealth() {
  const { say } = useFeedback();
  const nodes = useStore(data, (s) => s.nodes);
  const selected = useStore(runtime, (s) => s.status?.selectedId);
  const items = nodes.slice(0, 4).map((n: Node) => {
    const untested = !n.latency || n.latency === -99;
    return {
      key: n.id,
      title: n.name,
      detail: n.id === selected ? "活动节点" : n.type.toUpperCase(),
      badge: (
        <StatusBadge tone={untested ? "neutral" : GRADE_TONE[latencyGrade(n.latency)]}>
          {latencyText(n.latency)}
        </StatusBadge>
      ),
      actions:
        n.id === selected ? [] : [{ key: "use", label: "设为活动", onSelect: () => void selectNode(n.id).then(say) }],
    };
  });
  return (
    <Panel
      title="节点健康"
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate("nodes")}>
          全部节点
        </Button>
      }
      flush
    >
      <ActionList label="节点健康" dense items={items} actionStyle="inline" emptyLabel="还没有节点" />
    </Panel>
  );
}

const LEVEL_ICON = { INFO: <Info />, WARN: <CircleAlert />, ERROR: <CircleAlert /> };
const LEVEL_TONE = { INFO: "neutral", WARN: "attention", ERROR: "danger" } as const;

export function RecentLogs() {
  const recent = useStore(runtime, (s) => s.recent);
  const items = recent.map((l, i) => ({
    key: `${l.time}-${i}`,
    icon: l.level === "INFO" ? <CircleCheck /> : LEVEL_ICON[l.level],
    tone: LEVEL_TONE[l.level],
    title: l.msg,
    meta: l.time,
  }));
  return (
    <Panel
      title="最新日志"
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate("logs")}>
          更多
        </Button>
      }
      flush
    >
      <ActionList label="最新日志" dense items={items} emptyLabel="暂无日志" />
    </Panel>
  );
}
