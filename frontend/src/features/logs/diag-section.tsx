// 诊断（「日志与诊断」页的一个分区）：日志级别、本机日志文件（保留天数 / 打开文件夹）、日志上传说明、去「清除与重置」修网络。
import { Choice, FormField, FormSection, Panel } from "@ankotti/admin-ui";
import { openSettings } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { setLogLevel, system } from "../../state/system";
import { LinkRow } from "../settings/link-row";
import { LogFilesFields } from "./log-files-fields";

const LOG_LEVELS = ["error", "warn", "info", "debug"].map((v) => ({ value: v, label: v }));

export function DiagSection() {
  const { say } = useFeedback();
  const logLevel = useStore(system, (s) => s.logLevel);
  return (
    <Panel
      className="qd-pane"
      title="诊断"
      description="运行日志会保存在本机日志文件夹，并自动上传到服务器方便排查问题（都不含节点密码、账号密钥和完整手机号）。"
    >
      <FormSection>
        <FormField label="日志级别" htmlFor="log-level" hint="debug 最详细，排查问题时再开">
          <Choice
            label="日志级别"
            value={logLevel}
            options={LOG_LEVELS}
            onChange={(v) => void setLogLevel(v).then((e) => say(e, "error"))}
          />
        </FormField>
        <LogFilesFields />
        <LinkRow
          id="diag-reset"
          label="网页打不开 / 节点连不上"
          hint="清 DNS 缓存、清理残留系统代理和内核进程都在「清除与重置」"
          actions={[{ label: "清除与重置", onClick: () => openSettings("reset") }]}
        />
      </FormSection>
    </Panel>
  );
}
