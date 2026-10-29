// 本机日志文件：保留天数（1–30，默认 7）和「打开日志文件夹」。输入框离开时才保存。
import { Button, FormField, NumberInput } from "@ankotti/admin-ui";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/backend";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { useSaveSettings } from "../settings/setting-fields";

const DEFAULT_DAYS = 7;

export function LogFilesFields() {
  const { say } = useFeedback();
  const save = useSaveSettings();
  const saved = useStore(data, (s) => s.settings.logRetentionDays) || DEFAULT_DAYS;
  const [draft, setDraft] = useState<number | null>(saved);
  useEffect(() => setDraft(saved), [saved]);

  const commit = () => {
    const days = Math.min(30, Math.max(1, Math.round(draft ?? DEFAULT_DAYS)));
    setDraft(days);
    if (days !== saved) save({ logRetentionDays: days });
  };

  return (
    <>
      <FormField
        label="日志保留天数"
        htmlFor="log-days"
        hint="运行日志每天存一个文件，超过天数的自动删除（1–30 天，默认 7 天）"
      >
        <NumberInput id="log-days" value={draft} min={1} max={30} onChange={setDraft} onBlur={commit} />
      </FormField>
      <FormField label="日志文件" htmlFor="log-dir" hint="遇到问题可以把当天的日志文件发给客服">
        <Button
          id="log-dir"
          size="sm"
          variant="outline"
          onClick={() => void api.openLogDir().then((e) => say(e, "error"))}
        >
          <FolderOpen />
          打开日志文件夹
        </Button>
      </FormField>
    </>
  );
}
