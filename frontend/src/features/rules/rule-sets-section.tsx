// 规则库（geosite / geoip）：启停、手动更新；可选「添加节点后自动更新」。
import {
  Button,
  CellText,
  type Column,
  DataTable,
  FormField,
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
import { data, saveSettings } from "../../state/data";
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
  const { say } = useFeedback();
  const auto = useStore(data, (s) => s.settings.autoUpdateRules);
  return (
    <Panel title="更新方式">
      <div className="ps-stack">
        <FormField
          label="添加节点后自动更新规则库"
          htmlFor="rules-auto-update"
          hint="打开后每次加完节点自动更新一次。需代理运行中（规则库源在墙外，走节点下载）。默认关，手动更新更可控。"
        >
          <Switch
            id="rules-auto-update"
            checked={auto}
            onCheckedChange={(on) =>
              void saveSettings({ autoUpdateRules: on }).then((e) => say(e ? `保存失败：${e}` : ""))
            }
          />
        </FormField>
        <InlineAlert density="compact" title="规则库来自 sing-box 官方（SagerNet），已内置最新版">
          更新走当前节点下载（直连被墙），所以更新前请先「启动」并连上节点。
        </InlineAlert>
      </div>
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
