// 端口表的列与行内操作：开关 / 状态 / 名称 / 地址 / 节点 / 分流方式 / 连接数 / 设备数 / 流量 / 操作。
import {
  CellText,
  type Column,
  type RowAction,
  RowActionBar,
  SegmentedControl,
  StatusBadge,
  Switch,
} from "@ankotti/admin-ui";
import { Copy, Info, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { ProxyPortStatus } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { fmtBytes } from "../../shared/format";
import { useStore } from "../../shared/store";
import { ports, setPortEnabled, setPortMode } from "../../state/ports";
import { copyText, system } from "../../state/system";
import { connectAddress, listenAddress, MODE_OPTIONS, PROTOCOL_LABEL } from "./port-draft";

export type PortRowHandlers = {
  detail: (p: ProxyPortStatus) => void;
  edit: (p: ProxyPortStatus) => void;
  remove: (p: ProxyPortStatus) => void;
};

function statusText(p: ProxyPortStatus): string {
  if (p.error) return p.error;
  if (p.running) return "运行中";
  return p.enabled ? "启动中…" : "已关闭";
}

function StatusCell({ p }: { p: ProxyPortStatus }) {
  if (p.error) return <span className="ps-port-err">{p.error}</span>;
  if (p.running) {
    return (
      <StatusBadge variant="dot" tone="success">
        运行中
      </StatusBadge>
    );
  }
  return (
    <StatusBadge variant="dot" tone={p.enabled ? "info" : "neutral"}>
      {p.enabled ? "启动中…" : "已关闭"}
    </StatusBadge>
  );
}

function EnableCell({ p }: { p: ProxyPortStatus }) {
  const { say } = useFeedback();
  const busy = useStore(ports, (s) => s.busy.includes(p.id));
  return (
    <Switch
      size="sm"
      aria-label={`${p.enabled ? "关闭" : "启动"}${p.name}`}
      checked={p.enabled}
      disabled={busy}
      onCheckedChange={(on) => void setPortEnabled(p.id, on).then((err) => say(err, "error"))}
    />
  );
}

function ModeCell({ p }: { p: ProxyPortStatus }) {
  const { say } = useFeedback();
  return (
    <SegmentedControl
      size="sm"
      label={`${p.name}的分流方式`}
      value={p.mode}
      options={MODE_OPTIONS}
      onValueChange={(mode) => void setPortMode(p.id, mode).then((err) => say(err, "error"))}
    />
  );
}

function rowActions(p: ProxyPortStatus, on: PortRowHandlers, copy: () => void): RowAction[] {
  return [
    { key: "detail", label: "详情", icon: <Info />, onSelect: () => on.detail(p) },
    { key: "edit", label: "编辑", icon: <Pencil />, onSelect: () => on.edit(p) },
    { key: "copy", label: "复制地址", icon: <Copy />, onSelect: copy },
    { key: "delete", label: "删除", icon: <Trash2 />, destructive: true, onSelect: () => on.remove(p) },
  ];
}

export function usePortColumns(on: PortRowHandlers): Column<ProxyPortStatus>[] {
  const { say } = useFeedback();
  const lanIP = useStore(system, (s) => s.lanIP);
  return useMemo(() => {
    const copy = (p: ProxyPortStatus) => {
      const addr = connectAddress(p, lanIP);
      void copyText(addr).then((ok) =>
        say(ok ? `已复制 ${addr}` : "复制失败，请手动选中复制", ok ? "success" : "error"),
      );
    };
    return [
      {
        key: "enabled",
        title: "启动",
        width: 56,
        mobile: "status",
        render: (p) => <EnableCell p={p} />,
      },
      {
        key: "status",
        title: "状态",
        width: 104,
        maxWidth: 260,
        truncate: statusText,
        render: (p) => <StatusCell p={p} />,
      },
      {
        key: "name",
        title: "名称",
        minWidth: 110,
        render: (p) => <CellText primary={p.name} secondary={PROTOCOL_LABEL[p.protocol] ?? p.protocol} />,
      },
      {
        key: "address",
        title: "地址",
        width: 136,
        render: (p) => <CellText primary={listenAddress(p)} secondary={p.lan ? "局域网可连" : "仅本机"} />,
      },
      {
        key: "node",
        title: "节点",
        minWidth: 120,
        render: (p) => <CellText primary={p.nodeName || "—"} secondary={p.node ? undefined : "默认 · 跟随当前节点"} />,
      },
      { key: "mode", title: "分流方式", width: 196, render: (p) => <ModeCell p={p} /> },
      {
        key: "conns",
        title: "连接 / 设备",
        width: 92,
        numeric: true,
        render: (p) => `${p.conns} / ${p.clients.length}`,
      },
      {
        key: "traffic",
        title: "流量",
        width: 104,
        numeric: true,
        render: (p) => <CellText primary={`↓ ${fmtBytes(p.download)}`} secondary={`↑ ${fmtBytes(p.upload)}`} />,
      },
      {
        key: "actions",
        title: "操作",
        kind: "actions",
        width: 136,
        render: (p) => (
          <RowActionBar max={2} label={`${p.name}的更多操作`} actions={rowActions(p, on, () => copy(p))} />
        ),
      },
    ];
  }, [on, lanIP, say]);
}
