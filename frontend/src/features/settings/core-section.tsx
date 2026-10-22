// 内核与更新：软件版本 / 自动更新、sing-box 内核版本 / 自动更新、本地端口、日志级别。
import { Button, Choice, DescriptionList, FormField, FormSection, Panel } from "@ankotti/admin-ui";
import { Download, RefreshCw } from "lucide-react";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { isRunning, runtime } from "../../state/runtime";
import { setLogLevel, system, updateCore } from "../../state/system";
import { appUpdate, checkAppUpdate } from "../../state/update";
import { SwitchField, useSaveSettings } from "./setting-fields";

const LOG_LEVELS = ["error", "warn", "info", "debug"].map((v) => ({ value: v, label: v }));

function CoreFacts() {
  const current = useStore(appUpdate, (s) => s.info.current);
  const coreVersion = useStore(runtime, (s) => s.coreVersion);
  const running = useStore(runtime, (s) => isRunning(s.status));
  const port = useStore(runtime, (s) => s.status?.corePort);
  return (
    <DescriptionList
      columns={3}
      layout="stacked"
      items={[
        { label: "ProxySplit 版本", value: `v${current}`, hint: "升级后自动重启，不会改动节点和规则" },
        { label: "sing-box 版本", value: coreVersion || "—", hint: "POWER云 标准内核" },
        { label: "本地端口", value: running ? port || "—" : "未运行", hint: "混合入站 SOCKS5 + HTTP，自动分配" },
      ]}
    />
  );
}

export function CoreSection() {
  const { say } = useFeedback();
  const save = useSaveSettings();
  const checking = useStore(appUpdate, (s) => s.busy);
  const coreUpdating = useStore(system, (s) => s.coreUpdating);
  const logLevel = useStore(system, (s) => s.logLevel);
  const autoCore = useStore(data, (s) => !s.settings.autoUpdateCoreOff);

  return (
    <Panel
      className="qd-pane"
      title="内核与更新"
      description="每次打开都会检查新版本，有新版自动下载安装并重启（代理自动恢复）；签名与 SHA256 校验通过才安装。内核来自 POWER云，同样校验后才装。"
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            loading={checking}
            loadingText="检查中…"
            onClick={() => void checkAppUpdate(false).then(say)}
          >
            <RefreshCw />
            检查软件更新
          </Button>
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
        </>
      }
    >
      <CoreFacts />
      <div className="ps-set-gap">
        <FormSection>
          <SwitchField
            id="auto-update-core"
            label="自动更新内核"
            hint="每小时检查 POWER云 发布的标准内核，有新版自动下载校验并重启内核（约 1 秒）；新内核起不来会自动换回旧内核"
            checked={autoCore}
            onChange={(on) => save({ autoUpdateCoreOff: !on })}
          />
          <FormField label="日志级别" htmlFor="log-level" hint="debug 最详细，排查问题时再开">
            <Choice
              label="日志级别"
              value={logLevel}
              options={LOG_LEVELS}
              onChange={(v) => void setLogLevel(v).then((e) => say(e, "error"))}
            />
          </FormField>
        </FormSection>
      </div>
    </Panel>
  );
}
