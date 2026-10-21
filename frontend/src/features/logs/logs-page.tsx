// 日志（T05 分区合并）：实时连接（T02：ResourcePanel + QueryBar + DataTable）/ 运行日志（Panel + 等宽日志列表）。
import { Button, TabbedPage, useUndoToast } from "@ankotti/admin-ui";
import { Activity, ScrollText, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStore } from "../../shared/store";
import { clearLogs, restoreLogs, runtime } from "../../state/runtime";
import { ConnsSection } from "./conns-section";
import { LogSection } from "./log-section";
import "./logs.css";

export function LogsPage() {
  const [tab, setTab] = useState("conns");
  const connCount = useStore(runtime, (s) => s.conns.length);
  const logCount = useStore(runtime, (s) => s.logs.length);
  const undoToast = useUndoToast();

  const clear = () => {
    let removed: string[] = [];
    void undoToast({
      title: "已清空日志",
      run: () => {
        removed = clearLogs();
      },
      undo: () => restoreLogs(removed),
    });
  };

  return (
    <TabbedPage
      title="日志"
      description="每条连接命中了哪条规则、走了哪个出口；下面是核心和分流引擎的原始日志。"
      actions={
        <Button size="sm" variant="outline" disabledReason={logCount ? undefined : "暂无日志"} onClick={clear}>
          <Trash2 />
          清空日志
        </Button>
      }
      value={tab}
      onValueChange={setTab}
      sections={[
        { id: "conns", label: "实时连接", icon: <Activity />, count: connCount },
        { id: "logs", label: "运行日志", icon: <ScrollText />, count: logCount },
      ]}
      render={(id) => (id === "conns" ? <ConnsSection /> : <LogSection />)}
    />
  );
}
