// 应用分流（T03 指标 + 列表）：分流概况 → 规则是否生效的提示 → 应用规则表；「添加应用」弹出进程选择器。
import { Button, PageBody, PageHeader } from "@ankotti/admin-ui";
import { Download, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useIntent } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { exportRules, refreshProcesses } from "../../state/app-rules";
import { AppPicker } from "./app-picker";
import { AppsAlerts } from "./apps-alerts";
import { AppsSummary } from "./apps-summary";
import { RulesTable } from "./rules-table";
import { useImportFlow } from "./use-import-flow";
import "./apps.css";

const HELP = (
  <>
    选择哪些程序走代理、走哪个节点，改动立即生效。
    <br />
    <b>只代理列出的</b>（日常推荐）：只有列表里已启用的程序走节点，其余程序（含没列出的）一律直连。
    <br />
    <b>默认全代理</b>：没列出的程序也走代理（默认按「规则」：大陆直连、境外走代理）；列出的程序按各自的「规则 / 全局 /
    直连 / 拦截」和节点走。
    <br />
    分流方式：规则 = 智能分流（大陆直连）· 全局 = 全走节点 · 直连 = 不走代理 · 拦截 = 断网。
  </>
);

export function AppsPage() {
  const { say } = useFeedback();
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const importFlow = useImportFlow();
  useIntent("add-app", openPicker);
  useEffect(() => {
    void refreshProcesses();
  }, []);

  return (
    <>
      <PageHeader
        title="应用分流"
        description={HELP}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={importFlow.start}>
              <Download />
              导入
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportRules().then(say)}>
              <Upload />
              导出
            </Button>
            <Button size="sm" onClick={openPicker}>
              <Plus />
              添加应用
            </Button>
          </>
        }
      />
      <PageBody fill>
        <AppsSummary />
        <AppsAlerts />
        <RulesTable onAdd={openPicker} />
      </PageBody>
      <AppPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      {importFlow.dialogs}
    </>
  );
}
