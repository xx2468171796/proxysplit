// 设置：SideNavLayout 分节（常规 / 网络与接管 / 内核与节点 / 规则 / AI 加速 / 账号 / 诊断 / 清除与重置），
// 每节一个 Panel；开关改了立即生效，所以不放保存条。每个功能只有一个正式位置，别处只放跳转（docs/ui-audit-2026-10.md）。
import { PageBody, PageHeader, SideNavLayout, type SideNavSection } from "@ankotti/admin-ui";
import { Bot, Cpu, Eraser, ListFilter, Network, SlidersHorizontal, Stethoscope, UserRound, Zap } from "lucide-react";
import { useEffect } from "react";
import { useSectionJump } from "../../app/nav";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { loadSystem } from "../../state/system";
import { AccountSection } from "../account/account-section";
import { AccelSection } from "./accel-section";
import { AIControlSection } from "./ai-control-section";
import { CoreSection } from "./core-section";
import { DiagSection } from "./diag-section";
import { GeneralSection } from "./general-section";
import { NetworkSection } from "./network-section";
import { ResetSection } from "./reset/reset-section";
import { RulesLinkSection } from "./rules-link-section";
import "./settings.css";

const BASE = "设置";
const BEFORE_ACCOUNT: SideNavSection[] = [
  { id: "general", label: "常规", group: BASE, icon: <SlidersHorizontal />, content: <GeneralSection /> },
  { id: "network", label: "网络与接管", group: BASE, icon: <Network />, content: <NetworkSection /> },
  { id: "core", label: "内核与节点", group: BASE, icon: <Cpu />, content: <CoreSection /> },
  { id: "rules", label: "规则", group: BASE, icon: <ListFilter />, content: <RulesLinkSection /> },
  // AI 劫持、环境配置、实时出口在独立的「AI」页（features/ai，业主 2026-10-28）；这里只留加速。
  { id: "accel", label: "Claude Code 加速", group: "AI 功能", icon: <Zap />, content: <AccelSection /> },
];
const ACCOUNT: SideNavSection = {
  id: "account",
  label: "账号与设备",
  group: "账号",
  icon: <UserRound />,
  content: <AccountSection />,
};
const AFTER_ACCOUNT: SideNavSection[] = [
  { id: "diag", label: "诊断", group: "维护", icon: <Stethoscope />, content: <DiagSection /> },
  { id: "ai", label: "AI 控制接口", group: "维护", icon: <Bot />, content: <AIControlSection /> },
  { id: "reset", label: "清除与重置", group: "维护", icon: <Eraser />, content: <ResetSection /> },
];

export function SettingsPage() {
  const licensed = useStore(license, (s) => s.status.enabled);
  // 自启 / 日志级别 / 局域网 IP / AI 接口信息可能在别处变了：进页面时重读一次（很便宜）。
  useEffect(() => void loadSystem(), []);
  useSectionJump();

  const sections = licensed ? [...BEFORE_ACCOUNT, ACCOUNT, ...AFTER_ACCOUNT] : [...BEFORE_ACCOUNT, ...AFTER_ACCOUNT];
  return (
    <>
      <PageHeader title="设置" />
      <PageBody>
        <SideNavLayout label="设置分节" sections={sections} />
      </PageBody>
    </>
  );
}
