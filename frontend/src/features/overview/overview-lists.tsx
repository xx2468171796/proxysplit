// 概览里的小块：应用分流摘要（N 条应用、M 条走代理）、节点健康（前 4 个节点）、最新日志。
import { ActionList, Button, Panel, StatusBadge } from "@ankotti/admin-ui";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { Node } from "../../api/types";
import { navigate } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { RuleIcon } from "../../components/app-icon";
import { latencyGrade, latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { apps, ruleDisplayName } from "../../state/app-rules";
import { data, selectNode } from "../../state/data";
import { lineLabel } from "../../state/routing";
import { runtime } from "../../state/runtime";

export function AppSplitSummary() {
  const rules = useStore(data, (s) => s.rules);
  const lines = useStore(data, (s) => s.lines);
  const procs = useStore(apps, (s) => s.procs);
  const proxied = rules.filter((r) => r.enabled && r.line !== "direct" && r.line !== "block").length;
  const items = rules.slice(0, 4).map((r) => ({
    key: r.match,
    icon: <RuleIcon rule={r} />,
    title: ruleDisplayName(r, procs),
    detail: r.enabled ? lineLabel(r.line, lines) : "已停用",
  }));
  return (
    <Panel
      className="qd-pane"
      title="应用分流"
      count={`${rules.length} 条应用 · ${proxied} 条走代理`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate("apps")}>
          管理应用
        </Button>
      }
      flush
    >
      <ActionList label="应用分流" dense items={items} emptyLabel="还没有添加应用" />
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
      className="qd-pane"
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
      className="qd-pane"
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
