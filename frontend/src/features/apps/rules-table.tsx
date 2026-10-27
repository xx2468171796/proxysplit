// 应用规则表：改动即保存（整表推给 Go）；删除可撤销，清空要确认。
import {
  Button,
  type Column,
  ConfirmDialog,
  DataTable,
  ResourcePanel,
  RowActionBar,
  useUndoToast,
} from "@ankotti/admin-ui";
import { Crosshair, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRule } from "../../api/types";
import { useStore } from "../../shared/store";
import { refreshAppStats } from "../../state/app-monitor";
import { clearRules, hasScope, insertRule, removeRule, ruleName } from "../../state/app-rules";
import { data } from "../../state/data";
import { AppMonitorDialog } from "./app-monitor-dialog";
import { MonitorCell } from "./monitor-badge";
import { AppCell, EnabledCell, LineCell, NodeCell, TestCell } from "./rule-cells";
import { ScopeDialog } from "./scope-dialog";

type Row = { rule: AppRule; index: number };

type Handlers = {
  onScope: (match: string) => void;
  onRemove: (row: Row) => void;
  onMonitor: (process: string) => void;
};

function useColumns({ onScope, onRemove, onMonitor }: Handlers): Column<Row>[] {
  return [
    { key: "app", title: "应用程序", minWidth: 180, width: 200, render: ({ rule }) => <AppCell rule={rule} /> },
    { key: "line", title: "分流方式", width: 120, render: ({ rule }) => <LineCell rule={rule} /> },
    { key: "node", title: "节点", width: 150, render: ({ rule }) => <NodeCell rule={rule} /> },
    {
      key: "enabled",
      title: "启用",
      width: 64,
      mobile: "status",
      render: ({ rule }) => <EnabledCell rule={rule} />,
    },
    {
      key: "monitor",
      title: "连接状态",
      width: 120,
      render: ({ rule }) => <MonitorCell rule={rule} onOpen={onMonitor} />,
    },
    { key: "test", title: "延迟", width: 90, render: ({ rule }) => <TestCell rule={rule} /> },
    {
      key: "actions",
      title: "操作",
      kind: "actions",
      width: 128,
      render: (row) => (
        <RowActionBar
          label={`${ruleName(row.rule)}的更多操作`}
          actions={[
            {
              key: "scope",
              label: hasScope(row.rule) ? "已指定网站" : "指定网站",
              icon: <Crosshair />,
              onSelect: () => onScope(row.rule.match),
            },
            {
              key: "delete",
              label: "删除",
              icon: <Trash2 />,
              destructive: true,
              menuOnly: false,
              onSelect: () => onRemove(row),
            },
          ]}
        />
      ),
    },
  ];
}

export function RulesTable({ onAdd }: { onAdd: () => void }) {
  const rules = useStore(data, (s) => s.rules);
  const undoToast = useUndoToast();
  const [scopeMatch, setScopeMatch] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [monitoring, setMonitoring] = useState<string | null>(null);
  useEffect(() => {
    void refreshAppStats();
    // admin-ui-audit-ignore short-poll: 桌面客户端读本机 Go 后端（Wails 绑定）的运行状态，不是服务器业务数据，没有推送通道
    const timer = setInterval(() => void refreshAppStats(), 2000);
    return () => clearInterval(timer);
  }, []);
  const rows = rules.map((rule, index) => ({ rule, index }));
  const scopeRule =
    scopeMatch === null ? undefined : rules.find((r) => r.match.toLowerCase() === scopeMatch.toLowerCase());

  const remove = ({ rule, index }: Row) =>
    void undoToast({
      title: `已删除「${ruleName(rule)}」`,
      failTitle: "删除失败",
      run: async () => {
        const err = await removeRule(rule.match);
        if (err) throw new Error(err);
      },
      undo: async () => {
        const err = await insertRule(index, rule);
        if (err) throw new Error(err);
      },
    });
  const columns = useColumns({ onScope: setScopeMatch, onRemove: remove, onMonitor: setMonitoring });

  return (
    <ResourcePanel
      title="应用规则"
      count={rules.length}
      unit="条"
      description="改动即自动保存，关了再开也在。"
      actions={
        <Button size="sm" variant="destructive-outline" disabled={rules.length === 0} onClick={() => setClearing(true)}>
          <Trash2 />
          清空规则
        </Button>
      }
    >
      <DataTable
        caption="应用规则"
        rows={rows}
        rowKey={(r) => r.rule.match}
        columns={columns}
        rowHeight="medium"
        pagination={{ mode: "all" }}
        emptyLabel="还没有应用。点「添加应用」，选择要走代理的程序即可。"
        emptyAction={
          <Button size="sm" onClick={onAdd}>
            <Plus />
            添加应用
          </Button>
        }
      />
      {monitoring ? <AppMonitorDialog process={monitoring} onClose={() => setMonitoring(null)} /> : null}
      {scopeRule ? <ScopeDialog rule={scopeRule} onClose={() => setScopeMatch(null)} /> : null}
      <ConfirmDialog
        open={clearing}
        title={`清空全部 ${rules.length} 条应用规则？`}
        description="清空后所有程序按「未列出的应用」走。"
        destructive
        confirmLabel="清空"
        onConfirm={async () => {
          const err = await clearRules();
          if (err) throw new Error(`清空失败：${err}`);
        }}
        onClose={() => setClearing(false)}
      />
    </ResourcePanel>
  );
}
