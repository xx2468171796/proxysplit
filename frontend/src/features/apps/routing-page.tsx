// 「分流」导航项（业主 2026-10-28 合并同类项）：应用分流 | 端口代理 两个分区，各自保留原页面的页头按钮。
import { TabbedPage } from "@ankotti/admin-ui";
import { LayoutGrid, Plug } from "lucide-react";
import { usePageTab } from "../../app/nav";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { PortsPage } from "../ports/ports-page";
import { AppsPage } from "./apps-page";

const TABS = ["apps", "ports"] as const;

export function RoutingPage() {
  const [tab, setTab] = usePageTab(TABS);
  const ruleCount = useStore(data, (s) => s.rules.length);
  return (
    <TabbedPage
      title="分流"
      value={tab}
      onValueChange={setTab}
      sections={[
        { id: "apps", label: "应用分流", icon: <LayoutGrid />, count: ruleCount },
        { id: "ports", label: "端口代理", icon: <Plug /> },
      ]}
      render={(id) => (id === "ports" ? <PortsPage /> : <AppsPage />)}
    />
  );
}
