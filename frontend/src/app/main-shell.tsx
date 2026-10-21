// 主界面外壳：侧栏菜单 + 顶栏（活动节点 / 代理策略 / 速率 / 启停 / 外观）+ 当前页。
// 桌面客户端一次只看一页：工作标签只有当前这一个（AdminShell 单页用法）。
import {
  AdminShell,
  ContentSkeleton,
  type NavItem,
  PanelErrorBoundary,
  SlowLoadingNote,
  useSlowLoading,
} from "@ankotti/admin-ui";
import { Gauge, LayoutGrid, Logs, Plug, Rss, Server, Settings, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
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
import { HeaderControls } from "./header-controls";
import { navigate, type PageId, usePage } from "./nav";
import { UpdateNotesDialog } from "./update-notes-dialog";

const PAGES: Record<PageId, { title: string; icon: NavItem["icon"]; render: () => ReactNode }> = {
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

type Props = { netBlocked: string; onDismissNetBlocked: () => void };

export function MainShell({ netBlocked, onDismissNetBlocked }: Props) {
  const page = usePage();
  const nodeCount = useStore(data, (s) => s.nodes.length);
  const ruleCount = useStore(data, (s) => s.rules.length);
  const { account, accountMenu, onSignOut, dialogs } = useAccountMenu();

  const badges: Partial<Record<PageId, number>> = { nodes: nodeCount, apps: ruleCount };
  const navigation: NavItem[] = ORDER.map((id) => ({
    id,
    title: PAGES[id].title,
    icon: PAGES[id].icon,
    badge: badges[id] || undefined,
  }));
  const current = PAGES[page];

  return (
    <>
      <AdminShell
        brand="ProxySplit"
        logo={<img src={logo} alt="" className="ps-logo" />}
        navigation={navigation}
        activeId={page}
        onNavigate={(id) => navigate(id as PageId)}
        onCloseTab={() => undefined}
        documentTitle={(t) => `${t} · ProxySplit`}
        account={account}
        accountMenu={accountMenu}
        onSignOut={onSignOut}
        accountAppearance={false}
        headerActions={<HeaderControls />}
        tabs={[
          {
            id: page,
            title: current.title,
            icon: current.icon,
            closable: false,
            content: (
              <>
                <Banners netBlocked={netBlocked} onDismissNetBlocked={onDismissNetBlocked} />
                <PageBody page={page} />
              </>
            ),
          },
        ]}
      />
      {dialogs}
      <AccountDialogs />
      <DonateDialog />
      <UpdateNotesDialog />
    </>
  );
}

/** 首屏数据到之前只给骨架（不让人在默认值上改配置）；页面渲染出错只坏这一块，菜单和顶栏照常。 */
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
