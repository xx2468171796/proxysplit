// 端口代理：给指纹浏览器 / 局域网设备用，每个端口是一条独立线路（自己的内核进程），可同时开多个、各自启停。
// 与「应用分流」是两种互不影响的模式。列表每 2 秒刷新。
import { Button, ConfirmDialog, DataTable, InlineAlert, PageBody, PageHeader, ResourcePanel } from "@ankotti/admin-ui";
import { CopyPlus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProxyPortStatus } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { ports, refreshPorts, removePort } from "../../state/ports";
import { system } from "../../state/system";
import { BatchDialog } from "./batch-dialog";
import { usePortColumns } from "./port-columns";
import { PortDetailPanel } from "./port-detail";
import { PortDialog } from "./port-dialog";
import "./ports.css";

const POLL_MS = 2000;

function usePortsPolling() {
  useEffect(() => {
    void refreshPorts();
    // admin-ui-audit-ignore short-poll: 桌面客户端读本机 Go 后端（Wails 绑定）的运行状态，不是服务器业务数据，没有推送通道
    const timer = setInterval(() => void refreshPorts(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
}

function Explainer() {
  const lanIP = useStore(system, (s) => s.lanIP);
  return (
    <InlineAlert tone="info" density="compact" title="给指纹浏览器 / 局域网设备用的本地代理端口">
      每个端口是一条独立线路，可同时开多个、各自启停；在浏览器里填「本机IP:端口」（SOCKS5 或 HTTP）即可。
      {lanIP ? (
        <>
          {" "}
          这台电脑的局域网 IP 是 <b>{lanIP}</b>，打开「局域网可连」的端口，别的设备填 <b>{lanIP}:端口</b>；本机用
          127.0.0.1。
        </>
      ) : null}{" "}
      和「应用分流」是两种互不影响的模式，可以同时用。
    </InlineAlert>
  );
}

export function PortsPage() {
  usePortsPolling();
  const { say } = useFeedback();
  const list = useStore(ports, (s) => s.list);
  const loaded = useStore(ports, (s) => s.loaded);
  const [editing, setEditing] = useState<ProxyPortStatus | "new" | null>(null);
  const [batch, setBatch] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // 默认看第一个端口；选中的被删了就回到第一个
  const detailId = list.some((p) => p.id === picked) ? picked : (list[0]?.id ?? null);
  const [removing, setRemoving] = useState<ProxyPortStatus | null>(null);

  const handlers = useMemo(
    () => ({ detail: (p: ProxyPortStatus) => setPicked(p.id), edit: setEditing, remove: setRemoving }),
    [],
  );
  const columns = usePortColumns(handlers);
  const openNew = useCallback(() => setEditing("new"), []);

  const confirmRemove = async () => {
    if (!removing) return;
    const err = await removePort(removing.id);
    if (err) throw new Error(err);
    say(`已删除「${removing.name}」`);
  };

  const actions = (
    <>
      <Button size="sm" variant="outline" onClick={() => setBatch(true)}>
        <CopyPlus />
        批量新建
      </Button>
      <Button size="sm" onClick={openNew}>
        <Plus />
        新建端口
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title="端口代理"
        description="给指纹浏览器 / 局域网设备用：每个端口是一条独立线路，可同时开多个。"
        actions={actions}
      />
      <PageBody fill>
        <Explainer />
        <ResourcePanel title="代理端口" count={list.length} unit="个">
          <DataTable
            caption="代理端口"
            rows={list}
            rowKey={(p) => p.id}
            columns={columns}
            rowHeight="medium"
            onRowClick={(p) => setPicked(p.id)}
            loading={!loaded}
            pagination={{ mode: "all" }}
            emptyLabel="还没有代理端口。点「新建端口」建一个，或「批量新建」一次建好几个。"
            emptyAction={
              <Button onClick={openNew}>
                <Plus />
                新建端口
              </Button>
            }
          />
        </ResourcePanel>
        {detailId && <PortDetailPanel key={detailId} id={detailId} />}
      </PageBody>
      {editing && <PortDialog port={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {batch && <BatchDialog onClose={() => setBatch(false)} />}
      <ConfirmDialog
        open={removing !== null}
        title={`删除端口「${removing?.name ?? ""}」？`}
        description="会先停止这个端口的内核进程，再删除设置；正在用它的浏览器会断开。"
        destructive
        confirmLabel="删除"
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
