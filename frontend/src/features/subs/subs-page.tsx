// 订阅（T02 资源列表）：订阅表 + 行内自动更新开关；页头按钮：全部更新、添加订阅。
import {
  Button,
  CellText,
  type Column,
  ConfirmDialog,
  DataTable,
  PageBody,
  PageHeader,
  ResourcePanel,
  RowActionBar,
  Switch,
} from "@ankotti/admin-ui";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Sub } from "../../api/types";
import { useIntent } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { removeSub, setSubAutoUpdate, subTasks, updateAllSubs, updateSub } from "../../state/subs";
import { SubDialog } from "./sub-dialog";

type Handlers = { edit: (s: Sub) => void; remove: (s: Sub) => void };

function useSubColumns(on: Handlers): Column<Sub>[] {
  const { say } = useFeedback();
  const pending = useStore(subTasks, (s) => s.pending);
  return useMemo(
    () => [
      {
        key: "sub",
        title: "订阅",
        minWidth: 240,
        render: (s) => <CellText primary={s.name} secondary={s.url} />,
      },
      { key: "count", title: "节点数", width: 88, numeric: true, render: (s) => s.nodeCount },
      { key: "last", title: "上次更新", width: 140, render: (s) => s.lastUpdate || "手动" },
      {
        key: "auto",
        title: "自动更新",
        width: 96,
        render: (s) => (
          <Switch
            size="sm"
            aria-label={`${s.name} 自动更新`}
            checked={s.autoUpdate}
            onCheckedChange={(on) => void setSubAutoUpdate(s.id, on).catch((e) => say(`设置失败：${String(e)}`))}
          />
        ),
      },
      {
        key: "actions",
        title: "操作",
        kind: "actions",
        width: 200,
        render: (s) => {
          const task = pending[s.id];
          return (
            <RowActionBar
              label={`${s.name}的更多操作`}
              actions={[
                {
                  key: "update",
                  label: task === "update" ? "更新中…" : "更新",
                  icon: <RefreshCw />,
                  disabled: task === "save",
                  disabledReason: "正在保存",
                  onSelect: () => void updateSub(s.id).then((err) => say(err || `「${s.name}」已更新`)),
                },
                { key: "edit", label: "编辑", icon: <Pencil />, onSelect: () => on.edit(s) },
                { key: "delete", label: "删除", icon: <Trash2 />, destructive: true, onSelect: () => on.remove(s) },
              ]}
            />
          );
        },
      },
    ],
    [pending, say, on],
  );
}

function UpdateAllButton() {
  const { say } = useFeedback();
  const subs = useStore(data, (s) => s.subs);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const failed = await updateAllSubs();
      say(failed ? `${failed} 个订阅更新失败，可单独重试` : "订阅已全部更新");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline"
      loading={busy}
      loadingText="更新中…"
      disabledReason={subs.length ? undefined : "还没有订阅"}
      onClick={() => void run()}
    >
      <RefreshCw />
      全部更新
    </Button>
  );
}

export function SubsPage() {
  const { say } = useFeedback();
  const subs = useStore(data, (s) => s.subs);
  const [editing, setEditing] = useState<Sub | "new" | null>(null);
  const [removing, setRemoving] = useState<Sub | null>(null);

  const openAdd = useCallback(() => setEditing("new"), []);
  useIntent("add-sub", openAdd);
  const handlers = useMemo<Handlers>(() => ({ edit: setEditing, remove: setRemoving }), []);
  const columns = useSubColumns(handlers);

  const confirmRemove = async () => {
    if (!removing) return;
    await removeSub(removing.id);
    say(`已删除订阅「${removing.name}」`);
  };

  return (
    <>
      <PageHeader
        title="订阅"
        description="机场订阅的节点数量和更新时间。开启自动更新后会定期拉取最新节点。"
        actions={
          <>
            <UpdateAllButton />
            <Button onClick={openAdd}>
              <Plus />
              添加订阅
            </Button>
          </>
        }
      />
      <PageBody fill>
        <ResourcePanel title="订阅" count={subs.length} unit="个">
          <DataTable
            caption="订阅"
            rows={subs}
            rowKey={(s) => s.id}
            columns={columns}
            rowHeight="medium"
            pagination={{ mode: "all" }}
            emptyLabel="还没有订阅，粘贴机场订阅链接添加"
            emptyAction={
              <Button onClick={openAdd}>
                <Plus />
                添加订阅
              </Button>
            }
          />
        </ResourcePanel>
      </PageBody>
      {editing && <SubDialog sub={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={removing !== null}
        title={`删除订阅「${removing?.name ?? ""}」？`}
        description={`订阅里的 ${removing?.nodeCount ?? 0} 个节点会一并移除。`}
        destructive
        confirmLabel="删除"
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
