// 常规：开机自启、关闭到托盘、主题、软件版本与检查更新（软件更新只在这里检查）。
import { Button, FormField, FormSection, Panel, SegmentedControl } from "@ankotti/admin-ui";
import { RefreshCw } from "lucide-react";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { setAutostart, system } from "../../state/system";
import { appUpdate, checkAppUpdate } from "../../state/update";
import { SwitchField, useSaveSettings } from "./setting-fields";

type Theme = "light" | "dark" | "system";
const asTheme = (t: string): Theme => (t === "dark" || t === "system" ? t : "light");

export function GeneralSection() {
  const { say } = useFeedback();
  const save = useSaveSettings();
  const trayClose = useStore(data, (s) => s.settings.trayClose);
  const theme = useStore(data, (s) => s.settings.theme);
  const autostart = useStore(system, (s) => s.autostart);
  const current = useStore(appUpdate, (s) => s.info.current);
  const checking = useStore(appUpdate, (s) => s.busy);

  return (
    <Panel className="qd-pane" title="常规" description="启动、托盘、外观和软件更新。">
      <FormSection>
        <FormField
          label={`软件版本 v${current}`}
          htmlFor="app-update"
          hint="每次打开和每小时都会自动检查；签名与 SHA256 校验通过才安装，升级后自动重启、代理自动恢复"
        >
          <Button
            id="app-update"
            size="sm"
            variant="outline"
            loading={checking}
            loadingText="检查中…"
            onClick={() => void checkAppUpdate(false).then(say)}
          >
            <RefreshCw />
            检查更新
          </Button>
        </FormField>
        <SwitchField
          id="autostart"
          label="开机自启"
          hint="登录 Windows 后自动运行"
          checked={autostart}
          onChange={(on) => void setAutostart(on).then((e) => say(e, "error"))}
        />
        <SwitchField
          id="tray-close"
          label="关闭到托盘"
          hint="点 × 最小化到托盘而非退出"
          checked={trayClose}
          onChange={(on) => save({ trayClose: on })}
        />
        <FormField label="主题" htmlFor="theme" hint="跟随 = 跟着 Windows 的深浅色">
          <SegmentedControl<Theme>
            label="主题"
            size="sm"
            value={asTheme(theme)}
            onValueChange={(v) => save({ theme: v })}
            options={[
              { value: "light", label: "亮" },
              { value: "dark", label: "暗" },
              { value: "system", label: "跟随" },
            ]}
          />
        </FormField>
      </FormSection>
    </Panel>
  );
}
