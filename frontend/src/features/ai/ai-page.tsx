// AI 页（业主 2026-10-28）：环境与出口（实时出口 IP、AI 环境检测与劫持、环境配置）| Claude Code 加速 | AI 控制接口。
// 加速和控制接口以前在设置里，合并同类项后都在这一页。
import { PageBody, TabbedPage } from "@ankotti/admin-ui";
import { Bot, Globe, Zap } from "lucide-react";
import { usePageTab } from "../../app/nav";
import { AIEnvPanel } from "../overview/ai-env-panel";
import { AccelSection } from "./accel-section";
import { AIControlSection } from "./ai-control-section";
import { EnvConfigSection } from "./env-config-section";
import { ExitsPanel } from "./exits-panel";
import "../settings/settings.css";
import "./ai-page.css";

const TABS = ["env", "accel", "control"] as const;

function EnvTab() {
  return (
    <PageBody>
      <div className="ps-stack">
        <ExitsPanel />
        <AIEnvPanel always />
        <EnvConfigSection />
      </div>
    </PageBody>
  );
}

export function AIPage() {
  const [tab, setTab] = usePageTab(TABS);
  return (
    <TabbedPage
      title="AI"
      value={tab}
      onValueChange={setTab}
      sections={[
        { id: "env", label: "环境与出口", icon: <Globe /> },
        { id: "accel", label: "Claude Code 加速", icon: <Zap /> },
        { id: "control", label: "AI 控制接口", icon: <Bot /> },
      ]}
      render={(id) => {
        if (id === "accel")
          return (
            <PageBody>
              <AccelSection />
            </PageBody>
          );
        if (id === "control")
          return (
            <PageBody>
              <AIControlSection />
            </PageBody>
          );
        return <EnvTab />;
      }}
    />
  );
}
