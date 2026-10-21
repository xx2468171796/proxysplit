// 规则库（geosite / geoip）：启停、手动更新；平时由客户端从深圳镜像自动同步。
import {
  Button,
  CellText,
  type Column,
  DataTable,
  InlineAlert,
  Panel,
  ResourcePanel,
  StatusBadge,
  Switch,
} from "@ankotti/admin-ui";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { RuleSet } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { routing, setRuleSetEnabled, updateRuleSets } from "../../state/routing";
import { isRunning, runtime } from "../../state/runtime";

function EnabledSwitch({ rs }: { rs: RuleSet }) {
  const { say } = useFeedback();
  const running = useStore(runtime, (s) => isRunning(s.status));
  const toggle = async (on: boolean) => {
    const err = await setRuleSetEnabled(rs.name, on);
    say(err ? `失败：${err}` : running ? "已保存并重启生效" : "已保存（启动后生效）");
  };
  return (
    <Switch size="sm" aria-label={`启用${rs.display}`} checked={rs.enabled} onCheckedChange={(on) => void toggle(on)} />
  );
}

const COLUMNS: Column<RuleSet>[] = [
  {
    key: "name",
    title: "规则库",
    minWidth: 260,
    render: (rs) => <CellText primary={rs.display} secondary={rs.desc} />,
  },
  {
    key: "state",
    title: "状态",
    width: 100,
    mobile: "status",
    render: (rs) => (
      <StatusBadge variant="dot" tone={rs.present ? "success" : "danger"}>
        {rs.present ? "已就绪" : "缺失"}
      </StatusBadge>
    ),
  },
  {
    key: "size",
    title: "大小 / 更新日期",
    width: 170,
    render: (rs) =>
      rs.present ? (
        <CellText primary={`${rs.sizeKB} KB`} secondary={rs.modified ? `更新于 ${rs.modified}` : undefined} />
      ) : (
        "—"
      ),
  },
  { key: "enabled", title: "启用", width: 80, render: (rs) => <EnabledSwitch rs={rs} /> },
];

function AutoUpdatePanel() {
  return (
    <Panel title="更新方式">
      <InlineAlert density="compact" title="自动更新，不用管">
        规则库来自 sing-box 官方（SagerNet），我们的国内服务器每天同步一次。软件打开后会自动检查，之后每 6
        小时再查一次，有新版就下载、校验后直接生效，不用开代理，也不用重启。想马上更新就点「手动更新规则库」。
      </InlineAlert>
    </Panel>
  );
}

export function RuleSetsSection() {
  const { say } = useFeedback();
  const ruleSets = useStore(routing, (s) => s.ruleSets);
  const [updating, setUpdating] = useState(false);
  const update = async () => {
    setUpdating(true);
    const err = await updateRuleSets();
    setUpdating(false);
    say(err ? `更新失败：${err}` : "规则库已更新");
  };
  return (
    <>
      <ResourcePanel
        title="规则库"
        count={ruleSets.length}
        unit="个"
        description="决定「哪些网站 / IP 走代理、哪些直连」的地区规则（geosite / geoip）。「代理策略」选「规则」时，靠这套库判断大陆直连、境外走代理；线路的「绕过大陆」也依赖它。"
        actions={
          <Button size="sm" loading={updating} loadingText="更新中…" onClick={() => void update()}>
            <RefreshCw />
            手动更新规则库
          </Button>
        }
      >
        <DataTable
          caption="规则库"
          rows={ruleSets}
          rowKey={(rs) => rs.name}
          columns={COLUMNS}
          rowHeight="medium"
          pagination={{ mode: "all" }}
          emptyLabel="暂无规则库信息"
        />
      </ResourcePanel>
      <AutoUpdatePanel />
    </>
  );
}
