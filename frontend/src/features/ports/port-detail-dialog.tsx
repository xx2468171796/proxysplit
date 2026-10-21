// 端口详情：来访设备（点一行只看该设备）+ 当前连接 / 访问日志 / 内核日志三个页签，打开期间每 2 秒刷新。
import { Button, Dialog, StatusBadge, Tabs } from "@ankotti/admin-ui";
import { useState } from "react";
import type { PortClient, ProxyPortStatus } from "../../api/types";
import { useStore } from "../../shared/store";
import { ports } from "../../state/ports";
import { AccessTable, ClientsTable, ConnsTable, CoreLogs } from "./detail-tables";
import { listenAddress, PROTOCOL_LABEL } from "./port-draft";
import { usePortDetail } from "./use-port-detail";

type Tab = "conns" | "access" | "logs";

function RunBadge({ port }: { port: ProxyPortStatus }) {
  if (port.error)
    return (
      <StatusBadge variant="dot" tone="danger">
        异常
      </StatusBadge>
    );
  return (
    <StatusBadge variant="dot" tone={port.running ? "success" : "neutral"}>
      {port.running ? "运行中" : "未运行"}
    </StatusBadge>
  );
}

type ClientsProps = { clients: PortClient[]; selected: string; onSelect: (ip: string) => void };

function ClientsBlock({ clients, selected, onSelect }: ClientsProps) {
  return (
    <section className="ps-port-detail-block">
      <div className="ps-port-detail-head">
        <span>
          来访设备 <b>{clients.length}</b> 台
          <small>{selected ? `只看 ${selected}` : "点一行只看这台设备的连接和日志"}</small>
        </span>
        {selected ? (
          <Button size="sm" variant="outline" onClick={() => onSelect("")}>
            查看全部设备
          </Button>
        ) : null}
      </div>
      <ClientsTable clients={clients} selected={selected} onSelect={onSelect} />
    </section>
  );
}

export function PortDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const port = useStore(ports, (s) => s.list.find((p) => p.id === id));
  const [client, setClient] = useState("");
  const [tab, setTab] = useState<Tab>("conns");
  const detail = usePortDetail(id, client);
  if (!port) return null;

  const items = [
    { value: "conns", label: "当前连接", count: detail?.conns.length ?? 0 },
    { value: "access", label: "访问日志", count: detail?.access.length ?? 0 },
    { value: "logs", label: "内核日志", count: detail?.logs.length ?? 0 },
  ];
  const proto = PROTOCOL_LABEL[port.protocol] ?? port.protocol;

  return (
    <Dialog
      open
      size="xl"
      title={`${port.name} · 详情`}
      description={`${listenAddress(port)} · ${proto} · ${port.nodeName || "当前节点"}`}
      titleAdornment={<RunBadge port={port} />}
      onClose={onClose}
    >
      <div className="ps-port-detail">
        <ClientsBlock clients={port.clients} selected={client} onSelect={setClient} />
        <Tabs label="端口详情" value={tab} onValueChange={(v) => setTab(v as Tab)} items={items}>
          {tab === "conns" && <ConnsTable conns={detail?.conns ?? []} />}
          {tab === "access" && <AccessTable access={detail?.access ?? []} />}
          {tab === "logs" && <CoreLogs logs={detail?.logs ?? []} />}
        </Tabs>
      </div>
    </Dialog>
  );
}
