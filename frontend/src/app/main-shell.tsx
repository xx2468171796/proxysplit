// 主界面外壳：qiantai 桌面外壳 DesktopShell（标题栏 + 左侧导航 + 内容区 + 「外观」面板 + 背景层）。
// 标题栏中间是活动节点 / 代理策略 / 速率，右侧启动 / 停止 + 自绘窗口按钮（Wails 无边框，见 window-controls.ts）；导航底部是账号菜单。
import { AccountMenu, ContentSkeleton, PanelErrorBoundary, SlowLoadingNote, useSlowLoading } from "@ankotti/admin-ui";
import { Gauge, LayoutGrid, Logs, type LucideIcon, Plug, Rss, Server, Settings, ShieldCheck } from "lucide-react";
import { DesktopShell } from "qiantai/desktop";
import { type ReactNode, useEffect } from "react";
import logo from "../assets/proxysplit-logo.svg";
import { AccountDialogs } from "../features/account/account-dialogs";
import { AppsPage } from "../features/apps/apps-page";
import { LogsPage } from "../features/logs/logs-page";
import { NodesPage } from "../features/nodes/nodes-page";
import { OverviewPage } from "../features/overview/overview-page";
import { PortsPage } from "../features/ports/ports-page";
import { RulesPage } from "../features/rules/rules-page";
import { SettingsPage } from "../features/settings/settings-page";
import { SubsPage } from "../features/subs/subs-page";
import { useStore } from "../shared/store";
import { data } from "../state/data";
import { useAccountMenu } from "./account-menu";
import { Banners } from "./banners";
import { DonateDialog } from "./donate-dialog";
import { PowerButton, TitleBarCenter } from "./header-controls";
import { navigate, type PageId, usePage } from "./nav";
import { asMode, desktopLook, STORAGE_KEY, seedDefaultAppearance, useResolvedDark } from "./theme";
import { UpdateNotesDialog } from "./update-notes-dialog";
import { useWindowControls } from "./window-controls";

const PAGES: Record<PageId, { title: string; icon: LucideIcon; render: () => ReactNode }> = {
  overview: { title: "概览", icon: Gauge, render: () => <OverviewPage /> },
  nodes: { title: "节点", icon: Server, render: () => <NodesPage /> },
  apps: { title: "应用分流", icon: LayoutGrid, render: () => <AppsPage /> },
  ports: { title: "端口代理", icon: Plug, render: () => <PortsPage /> },
  rules: { title: "分流规则", icon: ShieldCheck, render: () => <RulesPage /> },
  subs: { title: "订阅", icon: Rss, render: () => <SubsPage /> },
  logs: { title: "日志", icon: Logs, render: () => <LogsPage /> },
  settings: { title: "设置", icon: Settings, render: () => <SettingsPage /> },
};
const ORDER: PageId[] = ["overview", "nodes", "apps", "ports", "rules", "subs", "logs", "settings"];

seedDefaultAppearance();

type Props = { netBlocked: string; onDismissNetBlocked: () => void };

export function MainShell({ netBlocked, onDismissNetBlocked }: Props) {
  const page = usePage();
  const nodeCount = useStore(data, (s) => s.nodes.length);
  const ruleCount = useStore(data, (s) => s.rules.length);
  const dark = useResolvedDark(asMode(useStore(data, (s) => s.settings.theme)));
  const { account, accountMenu, onSignOut, dialogs } = useAccountMenu();
  const look = desktopLook(dark);
  const windowControls = useWindowControls();

  useEffect(() => {
    document.title = `${PAGES[page].title} · ProxySplit`;
  }, [page]);

  const badges: Partial<Record<PageId, number>> = { nodes: nodeCount, apps: ruleCount };
  const nav = ORDER.map((id) => {
    const Icon = PAGES[id].icon;
    return { id, label: PAGES[id].title, icon: <Icon size={16} aria-hidden="true" />, badge: badges[id] || undefined };
  });
  const content = (
    <div className="ps-content">
      <Banners netBlocked={netBlocked} onDismissNetBlocked={onDismissNetBlocked} />
      <PageBody page={page} />
    </div>
  );

  return (
    <>
      {look ? (
        <DesktopShell
          look={look}
          storageKey={STORAGE_KEY}
          windowControls={windowControls}
          title={
            <span className="ps-title">
              <img src={logo} alt="" className="ps-logo" />
              ProxySplit
            </span>
          }
          nav={nav}
          current={page}
          onNavigate={(id) => navigate(id as PageId)}
          center={<TitleBarCenter />}
          actions={
            <span className="ps-title-actions">
              <PowerButton />
            </span>
          }
          navFooter={
            <div className="ps-account">
              <AccountMenu account={account} items={accountMenu} onSignOut={onSignOut} appearance={false} />
            </div>
          }
        >
          {content}
        </DesktopShell>
      ) : (
        content
      )}
      {dialogs}
      <AccountDialogs />
      <DonateDialog />
      <UpdateNotesDialog />
    </>
  );
}

/** 首屏数据到之前只给骨架（不让人在默认值上改配置）；页面渲染出错只坏这一块，菜单和标题栏照常。 */
function PageBody({ page }: { page: PageId }) {
  const loaded = useStore(data, (s) => s.loaded);
  const slow = useSlowLoading(!loaded);
  if (!loaded) {
    return (
      <div className="ps-page-loading">
        <ContentSkeleton rows={6} label="正在读取配置…" />
        {slow ? <SlowLoadingNote /> : null}
      </div>
    );
  }
  return <PanelErrorBoundary key={page}>{PAGES[page].render()}</PanelErrorBoundary>;
}
