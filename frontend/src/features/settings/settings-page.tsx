// 设置：SideNavLayout 分节（常规 / 网络与接管 / DNS 与高级 / 内核与节点 / 账号 / 清除与重置）；规则入口在「分流规则」页、
// Claude Code 加速和 AI 控制接口在「AI」页、诊断在「日志与诊断」页（业主 2026-10-28 合并同类项）。
// 每节一个 Panel；开关改了立即生效，所以不放保存条。每个功能只有一个正式位置，别处只放跳转（docs/ui-audit-2026-10.md）。
import { PageBody, PageHeader, SideNavLayout, type SideNavSection } from "@ankotti/admin-ui";
import { Cpu, Eraser, Globe, Network, SlidersHorizontal, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useSectionJump } from "../../app/nav";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { loadSystem } from "../../state/system";
import { AccountSection } from "../account/account-section";
import { CoreSection } from "./core-section";
import { DNSSection } from "./dns-section";
import { GeneralSection } from "./general-section";
import { NetworkSection } from "./network-section";
import { ResetSection } from "./reset/reset-section";
import "./settings.css";

const BASE = "设置";
const BEFORE_ACCOUNT: SideNavSection[] = [
  { id: "general", label: "常规", group: BASE, icon: <SlidersHorizontal />, content: <GeneralSection /> },
  { id: "network", label: "网络与接管", group: BASE, icon: <Network />, content: <NetworkSection /> },
  { id: "dns", label: "DNS 与高级", group: BASE, icon: <Globe />, content: <DNSSection /> },
  { id: "core", label: "内核与节点", group: BASE, icon: <Cpu />, content: <CoreSection /> },
];
const ACCOUNT: SideNavSection = {
  id: "account",
  label: "账号与设备",
  group: "账号",
  icon: <UserRound />,
  content: <AccountSection />,
};
const AFTER_ACCOUNT: SideNavSection[] = [
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
