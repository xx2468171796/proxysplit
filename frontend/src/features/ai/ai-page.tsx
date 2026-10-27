// AI 页（业主 2026-10-28）：实时出口 IP、AI 环境检测与劫持、环境配置集中在这一页（以前分散在概览和设置）。
import { PageBody, PageHeader } from "@ankotti/admin-ui";
import { AIEnvPanel } from "../overview/ai-env-panel";
import { EnvConfigSection } from "./env-config-section";
import { ExitsPanel } from "./exits-panel";
import "./ai-page.css";

export function AIPage() {
  return (
    <>
      <PageHeader title="AI" />
      <PageBody>
        <div className="ps-stack">
          <ExitsPanel />
          <AIEnvPanel always />
          <EnvConfigSection />
        </div>
      </PageBody>
    </>
  );
}
