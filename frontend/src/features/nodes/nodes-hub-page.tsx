// 「节点」导航项（业主 2026-10-28 合并同类项）：节点 | 订阅 两个分区，各自保留原页面的页头按钮。
import { TabbedPage } from "@ankotti/admin-ui";
import { Rss, Server } from "lucide-react";
import { usePageTab } from "../../app/nav";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { SubsPage } from "../subs/subs-page";
import { NodesPage } from "./nodes-page";

const TABS = ["nodes", "subs"] as const;

export function NodesHubPage() {
  const [tab, setTab] = usePageTab(TABS);
  const nodeCount = useStore(data, (s) => s.nodes.length);
  const subCount = useStore(data, (s) => s.subs.length);
  return (
    <TabbedPage
      title="节点"
      value={tab}
      onValueChange={setTab}
      sections={[
        { id: "nodes", label: "节点", icon: <Server />, count: nodeCount },
        { id: "subs", label: "订阅", icon: <Rss />, count: subCount },
      ]}
      render={(id) => (id === "subs" ? <SubsPage /> : <NodesPage />)}
    />
  );
}
