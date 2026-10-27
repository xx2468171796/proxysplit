// 设置（T08 设置页）：SideNavLayout 分节，每节一个 Panel；开关改了立即生效，所以不放保存条。
import { PageBody, PageHeader, SideNavLayout, type SideNavSection } from "@ankotti/admin-ui";
import { Bot, Cpu, DatabaseBackup, Monitor, Split, UserRound, Zap } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { loadSystem } from "../../state/system";
import { AccountSection } from "../account/account-section";
import { AccelSection } from "./accel-section";
import { AIControlSection } from "./ai-control-section";
import { BackupSection } from "./backup-section";
import { CoreSection } from "./core-section";
import { EngineSection } from "./engine-section";
import { SystemSection } from "./system-section";
import "./settings.css";

const SECTIONS: SideNavSection[] = [
  // AI 劫持、环境配置、实时出口已移到独立的「AI」页（features/ai，业主 2026-10-28）。
  { id: "ai", label: "AI 控制", group: "AI 功能", icon: <Bot />, content: <AIControlSection /> },
  { id: "accel", label: "Claude Code 加速", group: "AI 功能", icon: <Zap />, content: <AccelSection /> },
  { id: "core", label: "内核与更新", group: "代理", icon: <Cpu />, content: <CoreSection /> },
  { id: "engine", label: "分流引擎", group: "代理", icon: <Split />, content: <EngineSection /> },
  { id: "system", label: "系统集成", group: "代理", icon: <Monitor />, content: <SystemSection /> },
  { id: "backup", label: "备份与重置", group: "维护", icon: <DatabaseBackup />, content: <BackupSection /> },
];
const ACCOUNT: SideNavSection = {
  id: "account",
  label: "账户与设备",
  group: "账户",
  icon: <UserRound />,
  content: <AccountSection />,
};

export function SettingsPage() {
  const licensed = useStore(license, (s) => s.status.enabled);
  // 自启 / 日志级别 / 局域网 IP / AI 接口信息可能在别处变了：进页面时重读一次（很便宜）。
  useEffect(() => void loadSystem(), []);

  return (
    <>
      <PageHeader title="设置" />
      <PageBody>
        <SideNavLayout label="设置分节" sections={licensed ? [ACCOUNT, ...SECTIONS] : SECTIONS} />
      </PageBody>
    </>
  );
}
