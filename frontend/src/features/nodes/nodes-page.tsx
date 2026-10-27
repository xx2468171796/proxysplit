// 节点（T02 资源列表）：搜索 + 排序 + 删除不通的 + 节点表；页头按钮：检测全部可用性、测活动节点速度、去添加订阅、添加节点。
import { Button, ConfirmDialog, DataTable, PageBody, PageHeader, QueryBar, ResourcePanel } from "@ankotti/admin-ui";
import { Gauge, Plus, Rss, Stethoscope } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Node } from "../../api/types";
import { navigate, useIntent } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { nodeShare, nodeTests, removeNode, testActiveSpeed, testAllLatency } from "../../state/nodes";
import { useNodeColumns } from "./node-columns";
import { NodeCoreDialog } from "./node-core-dialog";
import { NodeImportDialog } from "./node-import-dialog";
import { type NodeShare, NodeShareDialog } from "./node-share-dialog";
import { type NodeSort, NodeSortControl, RemoveDeadButton, sortNodes } from "./node-tools";
import { NodeViaDialog } from "./node-via-dialog";
import "./nodes.css";

const HELP =
  "TCP 延迟：直连到节点边缘的传输层延迟，反映线路是否可达。Google 延迟：经完整代理链路访问 Google（HTTP 204）的端到端延迟，反映真实可用性。点「设为活动」切换当前节点。";

function NodeActions({ onAdd }: { onAdd: () => void }) {
  const { say } = useFeedback();
  const allLatency = useStore(nodeTests, (s) => s.allLatency);
  const activeSpeed = useStore(nodeTests, (s) => s.activeSpeed);
  return (
    <>
      <Button
        variant="outline"
        loading={allLatency}
        loadingText="Google 检测中…"
        onClick={() => void testAllLatency().then(say)}
      >
        <Stethoscope />
        检测全部可用性
      </Button>
      <Button
        variant="outline"
        loading={activeSpeed}
        loadingText="下载测速中…"
        onClick={() => void testActiveSpeed().then(say)}
      >
        <Gauge />
        测活动节点速度
      </Button>
      <Button variant="outline" onClick={() => navigate("nodes", "add-sub", "subs")}>
        <Rss />
        添加订阅
      </Button>
      <Button onClick={onAdd}>
        <Plus />
        添加节点
      </Button>
    </>
  );
}

function matches(n: Node, q: string): boolean {
  return `${n.name} ${n.server} ${n.type}`.toLowerCase().includes(q);
}

export function NodesPage() {
  const { say } = useFeedback();
  const nodes = useStore(data, (s) => s.nodes);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [share, setShare] = useState<NodeShare | null>(null);
  const [coreOf, setCoreOf] = useState<Node | null>(null);
  const [viaOf, setViaOf] = useState<Node | null>(null);
  const [removing, setRemoving] = useState<Node | null>(null);
  const [sort, setSort] = useState<NodeSort>("default");

  const openAdd = useCallback(() => setAdding(true), []);
  useIntent("add-node", openAdd);

  const handlers = useMemo(
    () => ({
      share: (n: Node) =>
        void nodeShare(n.id).then((r) =>
          r.err || !r.link
            ? say(r.err || "生成分享链接失败")
            : setShare({ name: n.name, link: r.link, qr: r.qr ?? "" }),
        ),
      remove: (n: Node) => setRemoving(n),
      core: (n: Node) => setCoreOf(n),
      via: (n: Node) => setViaOf(n),
    }),
    [say],
  );
  const columns = useNodeColumns(handlers);
  const q = query.trim().toLowerCase();
  const matched = useMemo(() => sortNodes(q ? nodes.filter((n) => matches(n, q)) : nodes, sort), [nodes, q, sort]);

  const confirmRemove = async () => {
    if (!removing) return;
    const err = await removeNode(removing.id);
    if (err) throw new Error(err);
    say(`已删除「${removing.name}」`);
  };

  return (
    <>
      <PageHeader title="节点" description={HELP} actions={<NodeActions onAdd={openAdd} />} />
      <PageBody fill>
        <ResourcePanel
          title="节点"
          count={matched.length}
          unit="个"
          filters={
            <div className="ps-node-filters">
              <QueryBar
                variant="flush"
                value={query}
                onChange={setQuery}
                onSearch={() => undefined}
                onReset={() => setQuery("")}
                canReset={query !== ""}
                hits={q ? matched.length : null}
                placeholder="搜索节点名称、地址或类型"
              />
              <NodeSortControl value={sort} onChange={setSort} />
              <RemoveDeadButton nodes={nodes} />
            </div>
          }
        >
          <DataTable
            caption="节点"
            rows={matched}
            rowKey={(n) => n.id}
            columns={columns}
            rowHeight="medium"
            pagination={{ mode: "all" }}
            emptyKind={q ? "no-results" : "empty"}
            emptyLabel={q ? undefined : "还没有节点。点「添加节点」粘贴分享链接，或手动填写 SOCKS5 / HTTP 代理。"}
            emptyAction={
              q ? undefined : (
                <Button onClick={openAdd}>
                  <Plus />
                  添加节点
                </Button>
              )
            }
          />
        </ResourcePanel>
      </PageBody>
      {adding && <NodeImportDialog onClose={() => setAdding(false)} />}
      {coreOf && <NodeCoreDialog node={coreOf} onClose={() => setCoreOf(null)} />}
      {viaOf && <NodeViaDialog node={viaOf} onClose={() => setViaOf(null)} />}
      {share && <NodeShareDialog share={share} onClose={() => setShare(null)} />}
      <ConfirmDialog
        open={removing !== null}
        title={`删除节点「${removing?.name ?? ""}」？`}
        description="删除后要重新导入才能再用。"
        destructive
        confirmLabel="删除"
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
