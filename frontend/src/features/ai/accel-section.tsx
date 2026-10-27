// Claude Code 加速（docs/Claude加速-网关切换.md）：状态由应用生命周期每 3 秒刷新。
import {
  Button,
  DescriptionList,
  FormField,
  FormSection,
  Note,
  Panel,
  SegmentedControl,
  StatusBadge,
} from "@ankotti/admin-ui";
import { useFeedback } from "../../app/use-feedback";
import { fmtBytes } from "../../shared/format";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { accelSavedPercent, setAccelMode, setAccelOption, system } from "../../state/system";
import { SwitchField } from "../settings/setting-fields";

type Mode = "official" | "encode";

function AccelStats() {
  const accel = useStore(system, (s) => s.accel);
  const st = accel?.stats;
  if (!st?.relayed) return null;
  const resumed = st.resumed ? `，断线续传 ${st.resumed} 次` : "";
  return (
    <DescriptionList
      columns={1}
      items={[
        {
          label: "本次已加速",
          value: `${st.relayed} 次 · 省 ${accelSavedPercent(accel)}%`,
          hint: `原始 ${fmtBytes(st.reqBytes)}，实际发出 ${fmtBytes(st.frameBytes)}${resumed}`,
        },
      ]}
    />
  );
}

export function AccelSection() {
  const { say } = useFeedback();
  const accel = useStore(system, (s) => s.accel);
  const busy = useStore(system, (s) => s.accelBusy);
  const off = useStore(data, (s) => !!s.settings.claudeAccelOff);
  const autoOff = useStore(data, (s) => !!s.settings.claudeAccelAutoOff);
  const encode = accel?.mode === "encode";
  const rtt = encode && accel?.rttMs ? `（延迟 ${accel.rttMs} ms）` : "";
  const setMode = (mode: "official" | "encode" | "auto") => void setAccelMode(mode).then((e) => say(e, "error"));
  const setOption = (field: "claudeAccelOff" | "claudeAccelAutoOff", on: boolean) =>
    void setAccelOption(field, on).then((e) => say(e, "error"));

  return (
    <Panel
      className="qd-pane"
      title="Claude Code 加速"
      description="检测到当前线路落地是我们的节点时，自动把 Claude Code 请求压缩成「只发变化的部分」，上行流量省约 97%；官方订阅登录也能用。"
      actions={
        <StatusBadge tone={encode ? "success" : "neutral"} variant="dot">
          {encode ? "编码模式" : "官方默认"}
        </StatusBadge>
      }
    >
      <FormSection>
        <FormField label="当前模式" htmlFor="accel-mode" hint={`${accel?.reason || "检测中…"}${rtt}`}>
          <SegmentedControl<Mode>
            label="Claude Code 加速模式"
            size="sm"
            value={encode ? "encode" : "official"}
            disabled={busy || off}
            onValueChange={setMode}
            options={[
              { value: "official", label: "官方默认" },
              { value: "encode", label: "编码模式" },
            ]}
          />
        </FormField>
        {accel?.manual ? (
          <FormField label="已手动选择" htmlFor="accel-auto-back" hint="换线路后自动恢复；也可以现在交回自动">
            <Button id="accel-auto-back" size="sm" variant="outline" disabled={busy} onClick={() => setMode("auto")}>
              交回自动
            </Button>
          </FormField>
        ) : null}
        <SwitchField
          id="accel-auto"
          label="自动切换"
          hint="落地签名验证通过且中继连得通 → 编码模式；换到别的线路、断开代理 → 自动恢复官方默认"
          checked={!autoOff}
          disabled={off}
          onChange={(on) => setOption("claudeAccelAutoOff", on)}
        />
        <SwitchField
          id="accel-on"
          label="启用加速功能"
          hint="关闭后一律官方默认（会重启代理内核）"
          checked={!off}
          onChange={(on) => setOption("claudeAccelOff", on)}
        />
      </FormSection>
      <div className="ps-set-gap">
        <AccelStats />
      </div>
      <Note as="p" className="ps-set-note">
        {accel?.gatewayInUse
          ? "Claude Code 已配置了其他网关地址（例如公司网关），不接管。"
          : "切换后需要重新打开 Claude Code（或 VS Code 里的 Claude 插件）才生效；恢复官方默认时会把 Claude Code 配置逐字节还原。"}
      </Note>
    </Panel>
  );
}
