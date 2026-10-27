// 清除与重置（唯一入口）：缓存 / 网络修复 / 配置重置 / 备份与撤销。清单来自 Go（internal/service/reset_catalog.go）。
// AI 劫持不在这里：解除只能在「AI 劫持」分区点「恢复」，这里只放一行说明和跳转。
import { Button, FormSection, Note, Panel } from "@ankotti/admin-ui";
import { Eraser, ShieldAlert, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ResetItem } from "../../../api/reset";
import { openSettings } from "../../../app/nav";
import { useFeedback } from "../../../app/use-feedback";
import { useStore } from "../../../shared/store";
import { loadResetCenter, resetState, runReset, summarize, undoLastReset } from "../../../state/reset";
import { BackupRows } from "./backup-rows";
import { ResetConfirm } from "./reset-confirm";
import { ResetRow } from "./reset-row";

const GROUPS = [
  { id: "cache", title: "缓存", note: "只清缓存，不丢任何设置" },
  { id: "network", title: "网络修复", note: "异常退出、网页打不开时用" },
  { id: "config", title: "配置重置", note: "执行前自动备份，可撤销" },
] as const;

export function ResetSection() {
  const { say } = useFeedback();
  const center = useStore(resetState, (s) => s.center);
  const busy = useStore(resetState, (s) => s.busy);
  const loadError = useStore(resetState, (s) => s.loadError);
  const [pending, setPending] = useState<ResetItem | null>(null);
  useEffect(() => void loadResetCenter(), []);

  const items = center?.items ?? [];
  const run = async (item: ResetItem, confirm = "") => say(summarize(await runReset(item.id, [item.id], confirm)));
  const onRun = (item: ResetItem) => (item.danger === "safe" ? void run(item) : setPending(item));
  const safeCaches = items.filter((i) => i.group === "cache" && i.available && i.danger === "safe");

  return (
    <Panel
      className="qd-pane"
      title="清除与重置"
      description="所有清缓存、修网络、恢复默认的操作都在这里。"
      actions={
        <Button
          size="sm"
          variant="outline"
          loading={busy === "all-cache"}
          disabledReason={busy ? "正在执行" : safeCaches.length ? undefined : "暂无可清的缓存"}
          onClick={() =>
            void runReset(
              "all-cache",
              safeCaches.map((i) => i.id),
            ).then((r) => say(summarize(r)))
          }
        >
          <Eraser />
          一键清理缓存
        </Button>
      }
    >
      {loadError ? <Note tone="danger">{loadError}</Note> : null}
      {center?.lastBackup ? (
        <Note as="div" className="ps-reset-undo">
          <span>上次重置前的配置已备份（{center.lastBackup}）。</span>
          <Button size="sm" variant="outline" loading={busy === "undo"} onClick={() => void undoLastReset().then(say)}>
            <Undo2 />
            撤销上次重置
          </Button>
        </Note>
      ) : null}
      {GROUPS.map((g) => (
        <div key={g.id} className="ps-reset-group">
          <FormSection title={g.title} description={g.note} layout="side">
            {items
              .filter((i) => i.group === g.id)
              .map((i) => (
                <ResetRow key={i.id} item={i} busy={busy === i.id} disabled={busy !== ""} onRun={onRun} />
              ))}
          </FormSection>
        </div>
      ))}
      <div className="ps-reset-group">
        <BackupRows />
      </div>
      <Note as="div" className="ps-reset-undo">
        <span>
          <ShieldAlert className="ps-reset-icon" />
          AI 劫持不受这里任何一项影响（恢复出厂也保留开关和锁）；要解除只能到「AI 劫持」点「恢复」。
        </span>
        <Button size="sm" variant="ghost" onClick={() => openSettings("hijack")}>
          去 AI 劫持
        </Button>
      </Note>
      <ResetConfirm
        item={pending}
        onConfirm={(item) => run(item, center?.confirm ?? "")}
        onClose={() => setPending(null)}
      />
    </Panel>
  );
}
