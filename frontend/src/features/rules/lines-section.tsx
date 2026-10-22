// 自定义线路：出口 + 分流模式。删除时用到它的应用和「未列出的应用」默认线路改回「规则」。
import { Button, type Column, ConfirmDialog, DataTable, ResourcePanel, RowActionBar } from "@ankotti/admin-ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Line } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { lineNodeLabel } from "../../state/nodes";
import { deleteLine, lineName, modeLabel } from "../../state/routing";
import { LineDialog } from "./line-dialog";

/** 编辑中的线路：null = 新建，undefined = 没开弹框。 */
type Editing = Line | null | undefined;

export function LinesSection() {
  const { say } = useFeedback();
  const lines = useStore(data, (s) => s.lines);
  const nodes = useStore(data, (s) => s.nodes);
  const rules = useStore(data, (s) => s.rules);
  const custom = useMemo(() => lines.filter((l) => !l.builtin), [lines]);
  const [editing, setEditing] = useState<Editing>(undefined);
  const [removing, setRemoving] = useState<Line | null>(null);
  const usedBy = removing ? rules.filter((r) => r.line === removing.id).length : 0;

  const columns: Column<Line>[] = [
    { key: "name", title: "线路", minWidth: 180, render: (l) => <b>{lineName(l)}</b> },
    {
      key: "exit",
      title: "出口",
      width: 240,
      truncate: (l) => lineNodeLabel(l.node, nodes),
      render: (l) => lineNodeLabel(l.node, nodes),
    },
    { key: "mode", title: "分流模式", width: 140, render: (l) => modeLabel(l.routing.mode) },
    {
      key: "actions",
      title: "操作",
      kind: "actions",
      width: 140,
      render: (l) => (
        <RowActionBar
          label={`${l.name}的更多操作`}
          actions={[
            { key: "edit", label: "编辑", icon: <Pencil />, onSelect: () => setEditing(l) },
            {
              key: "delete",
              label: "删除",
              icon: <Trash2 />,
              destructive: true,
              menuOnly: false,
              onSelect: () => setRemoving(l),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <ResourcePanel
      title="线路"
      count={custom.length}
      unit="条"
      description="每条线路 = 一个出口节点 + 一套分流策略，在「应用分流」里为每个应用挑选走哪条线路。「国内直连、国外代理」靠规则库判断网站在不在国内。"
      actions={
        <Button size="sm" onClick={() => setEditing(null)}>
          <Plus />
          新建线路
        </Button>
      }
    >
      <DataTable
        caption="自定义线路"
        rows={custom}
        rowKey={(l) => l.id}
        columns={columns}
        pagination={{ mode: "all" }}
        emptyLabel="还没有自定义线路。内置线路：智能分流 / 全部代理 / 不走代理 / 禁止联网。点「新建线路」添加。"
      />
      {editing !== undefined ? <LineDialog line={editing} onClose={() => setEditing(undefined)} /> : null}
      <ConfirmDialog
        open={!!removing}
        title={`删除线路「${removing?.name ?? ""}」？`}
        impact={
          usedBy > 0
            ? `${usedBy} 个应用正在用它，删除后改回「智能分流」`
            : "用到它的应用和「未列出的应用」默认线路会改回「智能分流」"
        }
        destructive
        confirmLabel="删除"
        onConfirm={async () => {
          if (!removing) return;
          const err = await deleteLine(removing);
          if (err) throw new Error(err);
          say("线路已删除");
        }}
        onClose={() => setRemoving(null)}
      />
    </ResourcePanel>
  );
}
