// 配置备份：整份配置导出到文件 / 从文件导入（原「备份与重置」的导出导入部分）。
import { Button, FormField, FormSection } from "@ankotti/admin-ui";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../../../app/use-feedback";
import { exportConfig, importConfig } from "../../../state/system";

export function BackupRows() {
  const { say } = useFeedback();
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
    <FormSection title="备份" description="换电脑时先导出，到新电脑上导入" layout="side">
      <FormField label="配置备份" htmlFor="cfg-export" hint="节点 / 规则 / 线路 / 设置全部存到文件">
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
    </FormSection>
  );
}
