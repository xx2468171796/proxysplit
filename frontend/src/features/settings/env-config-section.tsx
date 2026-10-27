// 环境配置：把这台 Windows 的时区、区域格式、所在地区、浏览器语言、Claude Code 遥测、系统时间一键配好，
// 一键恢复成配置前的原样。后端 App.GetEnvConfig / ApplyEnvConfig / RestoreEnvConfig（env_app.go → pkg/aienv）。
import { Button, ConfirmDialog, Panel, StatusChecklist } from "@ankotti/admin-ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/backend";
import type { EnvItem } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";

/** 可配置、可恢复的项（对时这类一次性操作和只作说明的项不算）。 */
function configurable(i: EnvItem): boolean {
  return !!i.target && i.restorable;
}

function itemStatus(i: EnvItem): "ok" | "warning" | "unknown" {
  if (!configurable(i)) return "unknown";
  return i.done ? "ok" : "warning";
}

function statusText(i: EnvItem): string {
  if (configurable(i)) return i.done ? "已配置" : "未配置";
  return i.target ? "操作" : "说明";
}

function itemReason(i: EnvItem): string {
  const now = i.current ? `现在：${i.current}` : "";
  const goal = configurable(i) && !i.done ? ` → 配置成：${i.target}` : "";
  const ours = i.configured ? "（已由本软件配置，可恢复）" : "";
  return [`${now}${goal}${ours}`, i.note].filter(Boolean).join("。");
}

export function EnvConfigSection() {
  const { say } = useFeedback();
  const [items, setItems] = useState<EnvItem[]>([]);
  const [busy, setBusy] = useState("");
  const [confirmRestore, setConfirmRestore] = useState<"" | "env" | "all">("");

  const load = useCallback(async () => {
    setItems(await api.envConfig().catch(() => []));
  }, []);
  useEffect(() => void load(), [load]);

  const run = async (key: string, action: () => Promise<string>, ok: string) => {
    setBusy(key);
    try {
      say((await action()) || ok);
    } catch (e) {
      say(String(e), "error");
    } finally {
      setBusy("");
      await load();
    }
  };
  // 未配置 → 配置 / 对时；本软件配过的 → 单项恢复
  const itemAction = (i: EnvItem) => {
    const label = (text: string) => (busy === i.id ? "处理中…" : text);
    if (i.target && !i.done)
      return {
        label: label(configurable(i) ? "配置" : "立即对时"),
        disabled: !!busy,
        onSelect: () => void run(i.id, () => api.applyEnvConfig([i.id]), `已配置：${i.name}`),
      };
    if (i.configured && i.restorable)
      return {
        label: label("恢复"),
        disabled: !!busy,
        onSelect: () => void run(i.id, () => api.restoreEnvConfig([i.id]), `已恢复：${i.name}`),
      };
    return null;
  };
  const pending = items.filter((i) => configurable(i) && !i.done).length;
  const configured = items.some((i) => i.configured);

  return (
    <Panel
      className="qd-pane"
      title="环境配置"
      count={pending > 0 ? `${pending} 项可配置` : "已全部配置"}
      description="把这台电脑的时区、区域格式、所在地区、浏览器语言等和台湾出口对齐，减少被认成在大陆使用。配置前会记下原来的设置，随时可以一键恢复。和「AI 劫持」互相独立。"
      actions={
        <>
          <Button
            size="sm"
            loading={busy === "all"}
            disabled={!!busy || pending === 0}
            onClick={() => void run("all", () => api.applyEnvConfig([]), "已一键配置")}
          >
            一键配置
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy || !configured} onClick={() => setConfirmRestore("env")}>
            一键恢复
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setConfirmRestore("all")}>
            全部恢复（含 AI 劫持）
          </Button>
        </>
      }
    >
      <StatusChecklist
        caption="环境配置项"
        summary={false}
        items={items}
        getId={(i) => i.id}
        label={(i) => i.name}
        reason={itemReason}
        status={itemStatus}
        statusLabel={statusText}
        action={itemAction}
      />
      <ConfirmDialog
        open={confirmRestore === "env"}
        title="恢复成配置前的样子？"
        confirmLabel="确定恢复"
        description="会把本软件改过的时区、区域格式、所在地区、浏览器语言、Claude Code 设置逐项改回原来的值。AI 劫持不变，系统时间对时不受影响。"
        onConfirm={() => run("restore", () => api.restoreEnvConfig([]), "已恢复成配置前的样子")}
        onClose={() => setConfirmRestore("")}
      />
      <ConfirmDialog
        open={confirmRestore === "all"}
        title="全部恢复成默认？"
        confirmLabel="全部恢复"
        description="关闭 AI 劫持（解除 DNS 锁和开机锁定任务，AI 不再强制走线路），并把本软件改过的环境设置全部改回原来的值。之后关掉软件时 AI 会走本机网络。"
        onConfirm={() => run("restore-all", () => api.restoreAllAI(), "已全部恢复成默认")}
        onClose={() => setConfirmRestore("")}
      />
    </Panel>
  );
}
