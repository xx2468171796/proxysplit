// 应用库：内置安卓模拟器 + 用户自定义应用。打开时自动检测本机装了哪些（按安装目录认，目录下所有程序都算），
// 检测到的排前面、按目录一键加；没检测到的按已知进程名加。自定义的可新建 / 编辑 / 删除。
import { Button, Choice, Dialog, FormField, InlineAlert, RowActionBar, StatusBadge, Tag } from "@ankotti/admin-ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { CatalogApp } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { addCatalogApp, customApps, monitor, refreshCatalog, saveCustomApps } from "../../state/app-monitor";
import { BUILTIN_LINES, builtinLineOptions } from "../../state/routing";
import { CustomAppDialog } from "./custom-app-dialog";

const LINES = [
  { value: "global", label: BUILTIN_LINES.global.label, hint: "所有连接都走代理（模拟器推荐）" },
  ...builtinLineOptions(["rule", "direct"]),
];

type Editing = { app: CatalogApp | null } | null;

const rank = (a: CatalogApp) => (a.builtin && a.dirs?.length ? 0 : a.builtin ? 2 : 1);

function Item({ app, line, onEdit }: { app: CatalogApp; line: string; onEdit: (a: CatalogApp) => void }) {
  const { say } = useFeedback();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const { added, err } = await addCatalogApp(app, line);
    setBusy(false);
    const unit = app.dirs?.length ? "个目录" : "个进程";
    say(
      err ? `添加失败：${err}` : added ? `已添加「${app.name}」的 ${added} ${unit}` : `「${app.name}」已经都在规则里了`,
    );
  };
  const remove = async () => {
    const err = await saveCustomApps(customApps().filter((a) => a.id !== app.id));
    say(err ? `删除失败：${err}` : `已删除「${app.name}」`);
  };
  return (
    <div className="ps-catalog-item">
      <div>
        <span className="ps-row">
          <b>{app.name}</b>
          <Tag size="sm">{app.builtin ? "内置" : "自定义"}</Tag>
          {app.builtin && app.dirs?.length ? (
            <StatusBadge variant="dot" tone="success">
              本机已安装
            </StatusBadge>
          ) : null}
        </span>
        {app.dirs?.length ? (
          <small>按目录添加（目录下所有程序都走）：{app.dirs.join("、")}</small>
        ) : (
          <small>
            {app.builtin ? "本机没检测到，按进程名添加：" : ""}
            {app.processes.join("、")}
          </small>
        )}
        {app.note && !app.builtin ? <small>{app.note}</small> : null}
      </div>
      {app.builtin ? null : (
        <RowActionBar
          label={`${app.name}的更多操作`}
          actions={[
            { key: "edit", label: "编辑", icon: <Pencil />, onSelect: () => onEdit(app) },
            { key: "delete", label: "删除", icon: <Trash2 />, destructive: true, onSelect: () => void remove() },
          ]}
        />
      )}
      <Button size="sm" loading={busy} onClick={() => void add()}>
        <Plus />
        {app.dirs?.length ? "按目录添加" : "添加"}
      </Button>
    </div>
  );
}

export function CatalogDialog({ onClose }: { onClose: () => void }) {
  const raw = useStore(monitor, (s) => s.catalog);
  // 本机检测到的内置应用排前面，其次自定义，最后没检测到的
  const catalog = [...raw].sort((a, b) => rank(a) - rank(b));
  const [line, setLine] = useState("global");
  const [editing, setEditing] = useState<Editing>(null);
  useEffect(() => {
    void refreshCatalog();
  }, []);
  return (
    <Dialog
      open
      size="lg"
      title="应用库"
      description="自动检测本机装了哪些模拟器，按安装目录一键加进规则：目录下的所有程序都走代理，模拟器换了联网进程也能抓到。"
      headerActions={
        <Button size="sm" variant="outline" onClick={() => setEditing({ app: null })}>
          <Plus />
          自定义应用
        </Button>
      }
      onClose={onClose}
    >
      <div className="ps-catalog-list">
        <FormField label="加入后的分流方式" htmlFor="catalog-line">
          <Choice id="catalog-line" size="sm" label="分流方式" value={line} options={LINES} onChange={setLine} />
        </FormField>
        <InlineAlert density="compact" tone="info" title="安卓模拟器要用默认 NAT 网络">
          开了「网络桥接」的模拟器流量不经过电脑上的进程，抓不到；同一个模拟器多开时会一起走代理，分不开。加好后在规则表点「连接状态」→「立即检测」确认通了没有。
        </InlineAlert>
        {catalog.map((a) => (
          <Item key={a.id} app={a} line={line} onEdit={(app) => setEditing({ app })} />
        ))}
      </div>
      {editing ? <CustomAppDialog app={editing.app} onClose={() => setEditing(null)} /> : null}
    </Dialog>
  );
}
