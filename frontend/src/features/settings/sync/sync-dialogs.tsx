// 主界面常驻的同步弹框：导入预览确认 + 云同步冲突（「用云端 / 用本机」）。
import { Button, Dialog, InlineAlert } from "@ankotti/admin-ui";
import { useState } from "react";
import { useFeedback } from "../../../app/use-feedback";
import { fmtDateTime } from "../../../shared/format";
import { useStore } from "../../../shared/store";
import { configSync, resolveConflict } from "../../../state/configsync";
import { ImportPreviewDialog } from "./import-preview-dialog";
import "./sync.css";

function ConflictDialog() {
  const { say } = useFeedback();
  const conflict = useStore(configSync, (s) => s.status?.conflict ?? null);
  const [busy, setBusy] = useState<"" | "cloud" | "local">("");
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(0);
  if (!conflict || dismissed === conflict.cloudVersion) return null;
  const choose = async (choice: "cloud" | "local") => {
    setBusy(choice);
    setError("");
    const err = await resolveConflict(choice).finally(() => setBusy(""));
    if (err) return setError(err);
    say(choice === "cloud" ? "已换成云端配置，本机原配置已备份，可撤销" : "已用本机配置覆盖云端", "success");
  };
  const when = conflict.cloudUpdatedAt ? fmtDateTime(conflict.cloudUpdatedAt) : "最近";
  return (
    <Dialog
      open
      size="sm"
      title="云端和本机的配置都改过了"
      description={`云端配置在 ${when} 被「${conflict.cloudDevice || "另一台设备"}」更新过，本机也有没同步的改动。要保留哪一份？`}
      onClose={() => setDismissed(conflict.cloudVersion)}
      footer={
        <>
          <Button
            variant="outline"
            loading={busy === "local"}
            disabled={busy !== ""}
            onClick={() => void choose("local")}
          >
            用本机
          </Button>
          <Button loading={busy === "cloud"} disabled={busy !== ""} onClick={() => void choose("cloud")}>
            用云端
          </Button>
        </>
      }
    >
      <InlineAlert tone="info" title="两种选择">
        「用云端」：本机换成云端那份（换之前自动备份，可撤销）。「用本机」：把本机这份上传，覆盖云端。
      </InlineAlert>
      {error ? (
        <InlineAlert tone="error" title="没处理成功">
          {error}
        </InlineAlert>
      ) : null}
    </Dialog>
  );
}

export function SyncDialogs() {
  return (
    <>
      <ImportPreviewDialog />
      <ConflictDialog />
    </>
  );
}
