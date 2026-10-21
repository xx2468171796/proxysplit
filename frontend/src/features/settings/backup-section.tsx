// 备份与重置：整体配置导出 / 导入到文件；重置为默认（保留节点和订阅，先确认）。
import { Button, ConfirmDialog, FormField, FormSection, Panel } from "@ankotti/admin-ui";
import { Download, RotateCcw, Upload } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { exportConfig, importConfig, resetConfig } from "../../state/system";

export function BackupSection() {
  const { say } = useFeedback();
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState("");
  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    try {
      say(await action());
    } finally {
      setBusy("");
    }
  };

  return (
    <Panel title="备份与重置" description="换电脑时先导出，到新电脑上导入即可。">
      <FormSection>
        <FormField label="配置备份" htmlFor="cfg-export" hint="节点 / 规则 / 线路 / 设置全部存到文件，换机可导回">
          <div className="ps-set-actions">
            <Button
              id="cfg-export"
              size="sm"
              variant="outline"
              loading={busy === "export"}
              onClick={() => void run("export", exportConfig)}
            >
              <Download />
              导出配置
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === "import"}
              onClick={() => void run("import", importConfig)}
            >
              <Upload />
              导入配置
            </Button>
          </div>
        </FormField>
        <FormField
          label="重置为默认配置"
          htmlFor="cfg-reset"
          hint="恢复默认设置、清空应用规则 / 自定义线路 —— 保留你的节点和订阅"
        >
          <div className="ps-set-actions">
            <Button id="cfg-reset" size="sm" variant="destructive-outline" onClick={() => setConfirmReset(true)}>
              <RotateCcw />
              重置
            </Button>
          </div>
        </FormField>
      </FormSection>
      <ConfirmDialog
        open={confirmReset}
        title="重置为默认配置？"
        destructive
        confirmLabel="重置"
        description="会清空：应用规则、自定义线路、所有开关设置（恢复默认）。会保留：你添加的节点和订阅。"
        onConfirm={async () => say(await resetConfig())}
        onClose={() => setConfirmReset(false)}
      />
    </Panel>
  );
}
