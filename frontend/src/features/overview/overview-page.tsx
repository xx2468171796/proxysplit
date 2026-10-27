// 概览（给普通用户看的首页）：连接面板（大开关 / 节点 / 速率 / 分流方式）→ AI 环境（有资格才显示）→ 常用操作 →
// 节点健康 + 应用分流摘要 → 最新日志。
import { PageBody, Panel, QuickLinks } from "@ankotti/admin-ui";
import { LayoutGrid, Plus, RefreshCw, Stethoscope } from "lucide-react";
import { navigate } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { nodeTests, testAllLatency } from "../../state/nodes";
import { AIEnvPanel } from "./ai-env-panel";
import { ConnectHero } from "./hero";
import { AppSplitSummary, NodeHealth, RecentLogs } from "./overview-lists";

function QuickActions() {
  const { say } = useFeedback();
  const testing = useStore(nodeTests, (s) => s.allLatency);
  return (
    <Panel className="qd-pane" title="常用操作">
      <QuickLinks
        columns={4}
        items={[
          { key: "node", label: "添加节点", icon: <Plus />, onSelect: () => navigate("nodes", "add-node") },
          { key: "app", label: "添加应用", icon: <LayoutGrid />, onSelect: () => navigate("apps", "add-app") },
          {
            key: "test",
            label: testing ? "测速中…" : "全部测速",
            icon: <RefreshCw />,
            onSelect: () => void testAllLatency().then(say),
          },
          { key: "diag", label: "网络诊断", icon: <Stethoscope />, onSelect: () => navigate("logs", null, "diag") },
        ]}
      />
    </Panel>
  );
}

export function OverviewPage() {
  return (
    <PageBody>
      <div className="ps-stack">
        <ConnectHero />
        <AIEnvPanel />
        <QuickActions />
        <div className="ps-overview-grid">
          <NodeHealth />
          <AppSplitSummary />
        </div>
        <RecentLogs />
      </div>
    </PageBody>
  );
}
