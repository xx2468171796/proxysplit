// 内核与节点：sing-box 版本 / 本地端口、立即更新内核、自动更新内核；节点内核选择的批量恢复在「清除与重置」。
import { Button, DescriptionList, FormSection, Panel } from "@ankotti/admin-ui";
import { Download } from "lucide-react";
import { navigate, openSettings } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { isRunning, runtime } from "../../state/runtime";
import { system, updateCore } from "../../state/system";
import { LinkRow } from "./link-row";
import { SwitchField, useSaveSettings } from "./setting-fields";

function CoreFacts() {
  const coreVersion = useStore(runtime, (s) => s.coreVersion);
  const running = useStore(runtime, (s) => isRunning(s.status));
  const port = useStore(runtime, (s) => s.status?.corePort);
  const nodeCount = useStore(data, (s) => s.nodes.length);
  return (
    <DescriptionList
      columns={3}
      layout="stacked"
      items={[
        { label: "sing-box 版本", value: coreVersion || "—", hint: "POWER云 标准内核" },
        { label: "本地端口", value: running ? port || "—" : "未运行", hint: "混合入站 SOCKS5 + HTTP，自动分配" },
        { label: "节点", value: `${nodeCount} 个`, hint: "Xray 节点按需自动下载内核" },
      ]}
    />
  );
}

export function CoreSection() {
  const { say } = useFeedback();
  const save = useSaveSettings();
  const coreUpdating = useStore(system, (s) => s.coreUpdating);
  const autoCore = useStore(data, (s) => !s.settings.autoUpdateCoreOff);

  return (
    <Panel
      className="qd-pane"
      title="内核与节点"
      description="内核来自 POWER云，签名与 SHA256 校验通过才安装；新内核起不来会自动换回旧内核。"
      actions={
        <Button
          size="sm"
          variant="outline"
          loading={coreUpdating}
          loadingText="检查中…"
          tooltip="立即检查 POWER云 标准内核（签名 + SHA256 校验）"
          onClick={() => void updateCore().then(say)}
        >
          <Download />
          更新内核
        </Button>
      }
    >
      <CoreFacts />
      <div className="ps-set-gap">
        <FormSection>
          <SwitchField
            id="auto-update-core"
            label="自动更新内核"
            hint="每小时检查一次，有新版自动下载校验并重启内核（约 1 秒）"
            checked={autoCore}
            onChange={(on) => save({ autoUpdateCoreOff: !on })}
          />
          <LinkRow
            id="core-nodes"
            label="节点与每个节点的内核"
            hint="在节点页逐个选择 sing-box / Xray；全部恢复自动在「清除与重置」"
            actions={[
              { label: "打开节点页", onClick: () => navigate("nodes") },
              { label: "清除与重置", onClick: () => openSettings("reset") },
            ]}
          />
        </FormSection>
      </div>
    </Panel>
  );
}
