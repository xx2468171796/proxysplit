// 概览（T01 工作台首页）：指标带 → 左：AI 环境检测、分流链路、应用流量；右：快速操作、节点健康、最新日志。
import {
  Button,
  PageBody,
  PageHeader,
  Panel,
  QuickLinks,
  SplitLayout,
  type StatItem,
  StatStrip,
  StatusBadge,
} from "@ankotti/admin-ui";
import { Activity, LayoutGrid, Plus, RefreshCw, Server, Stethoscope, Wifi, Zap } from "lucide-react";
import { useMemo } from "react";
import type { AppRule, Node, Status } from "../../api/types";
import { navigate } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { fmtUptime, latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { data, reloadData } from "../../state/data";
import { nodeTests, testAllLatency } from "../../state/nodes";
import { isRunning, refreshHealth, refreshStatus, restartCore, runtime, toggleRun } from "../../state/runtime";
import { AIEnvPanel } from "./ai-env-panel";
import { AppTraffic, NodeHealth, RecentLogs } from "./overview-lists";
import { RouteFlow } from "./route-flow";

function runtimeStats(status: Status | null): StatItem[] {
  const running = isRunning(status);
  const core: StatItem = running
    ? {
        key: "core",
        label: "核心状态",
        icon: <Wifi />,
        value: "运行中",
        note: `已运行 ${fmtUptime(status?.uptimeSec ?? 0)}`,
      }
    : { key: "core", label: "核心状态", icon: <Wifi />, value: "已停止", note: "点右上角「启动」", tone: "attention" };
  const conns: StatItem = {
    key: "conns",
    label: "活动连接",
    icon: <Activity />,
    value: running ? (status?.stats?.activeConns ?? 0) : null,
    unit: "个",
    note: running ? `本地端口 ${status?.corePort || "—"}` : "未运行",
    onSelect: () => navigate("logs"),
  };
  return [core, conns];
}

function dataStats(active: Node | undefined, rules: AppRule[], tunMode: boolean): StatItem[] {
  const proxied = rules.filter((r) => r.enabled && r.line !== "direct" && r.line !== "block").length;
  return [
    {
      key: "node",
      label: "活动节点",
      icon: <Server />,
      value: active?.name ?? "未选择",
      note: active ? latencyText(active.latency) : "到「节点」页选择",
      onSelect: () => navigate("nodes"),
    },
    {
      key: "rules",
      label: "应用规则",
      icon: <LayoutGrid />,
      value: rules.length,
      unit: "条",
      note: `${proxied} 条走代理`,
      onSelect: () => navigate("apps"),
    },
    {
      key: "scope",
      label: "代理范围",
      icon: <Zap />,
      value: tunMode ? "整机全局" : "应用分流",
      note: tunMode ? "所有程序都走代理" : "按程序分配线路",
      onSelect: () => navigate("settings"),
    },
  ];
}

function useOverviewStats(): StatItem[] {
  const status = useStore(runtime, (s) => s.status);
  const nodes = useStore(data, (s) => s.nodes);
  const rules = useStore(data, (s) => s.rules);
  const tunMode = useStore(data, (s) => s.settings.tunMode);
  return useMemo(() => {
    const [core, conns] = runtimeStats(status);
    const [node, ruleStat, scope] = dataStats(
      nodes.find((n) => n.id === status?.selectedId),
      rules,
      tunMode,
    );
    return [core, node, ruleStat, conns, scope].filter((x): x is StatItem => !!x);
  }, [status, nodes, rules, tunMode]);
}

export function OverviewPage() {
  const { say } = useFeedback();
  const running = useStore(runtime, (s) => isRunning(s.status));
  const busy = useStore(runtime, (s) => s.busy);
  const testing = useStore(nodeTests, (s) => s.allLatency);
  const stats = useOverviewStats();
  const refresh = async () => {
    await Promise.all([reloadData(), refreshStatus(), refreshHealth()]);
    say("状态已刷新", "info");
  };

  return (
    <>
      <PageHeader
        title="概览"
        description="运行状态、分流链路和常用操作。"
        actions={
          <>
            {running ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void restartCore().then((e) => say(e || "已重启"))}
              >
                <RefreshCw />
                重启核心
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              刷新状态
            </Button>
            <Button size="sm" loading={busy} onClick={() => void toggleRun().then(say)}>
              {running ? "停止服务" : "启动服务"}
            </Button>
          </>
        }
      />
      <PageBody>
        <StatStrip
          title="运行状况"
          actions={
            <StatusBadge tone={running ? "success" : "neutral"} pulse={running}>
              {running ? "代理运行中" : "代理未运行"}
            </StatusBadge>
          }
          items={stats}
        />
        <SplitLayout
          rail={
            <>
              <Panel title="快速操作">
                <QuickLinks
                  columns={4}
                  items={[
                    { key: "node", label: "添加节点", icon: <Plus />, onSelect: () => navigate("nodes", "add-node") },
                    {
                      key: "app",
                      label: "添加应用",
                      icon: <LayoutGrid />,
                      onSelect: () => navigate("apps", "add-app"),
                    },
                    {
                      key: "test",
                      label: testing ? "测速中…" : "全部测速",
                      icon: <RefreshCw />,
                      onSelect: () => void testAllLatency().then(say),
                    },
                    { key: "diag", label: "网络诊断", icon: <Stethoscope />, onSelect: () => navigate("logs") },
                  ]}
                />
              </Panel>
              <NodeHealth />
              <RecentLogs />
            </>
          }
        >
          <AIEnvPanel />
          <RouteFlow />
          <AppTraffic />
        </SplitLayout>
      </PageBody>
    </>
  );
}
