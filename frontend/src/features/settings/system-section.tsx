// 系统集成：代理范围、系统代理（不需要）、局域网共享、开机自启、关闭到托盘、主题。
import { FormField, FormSection, Panel, SegmentedControl } from "@ankotti/admin-ui";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data, saveSettings } from "../../state/data";
import { setAutostart, system } from "../../state/system";
import { LanShareFields } from "./lan-share-fields";
import { SwitchField, useSaveSettings } from "./setting-fields";

type Scope = "split" | "tun";
type Theme = "light" | "dark" | "system";
const asTheme = (t: string): Theme => (t === "dark" || t === "system" ? t : "light");

/** 切换代理范围会重启内核：切换中先锁住，避免连点。 */
function ScopeField() {
  const { say } = useFeedback();
  const tun = useStore(data, (s) => s.settings.tunMode);
  const [switching, setSwitching] = useState(false);
  const change = async (v: Scope) => {
    if ((v === "tun") === tun || switching) return;
    setSwitching(true);
    try {
      say(await saveSettings({ tunMode: v === "tun" }), "error");
    } finally {
      setSwitching(false);
    }
  };
  return (
    <FormField label="代理范围" htmlFor="proxy-scope" hint={switching ? "切换中…" : "指定应用分流，或接管整台电脑"}>
      <SegmentedControl<Scope>
        label="代理范围"
        size="sm"
        value={tun ? "tun" : "split"}
        disabled={switching}
        onValueChange={(v) => void change(v)}
        options={[
          { value: "split", label: "应用分流" },
          { value: "tun", label: "整机全局" },
        ]}
      />
    </FormField>
  );
}

export function SystemSection() {
  const { say } = useFeedback();
  const save = useSaveSettings();
  const lanShare = useStore(data, (s) => s.settings.lanShare);
  const trayClose = useStore(data, (s) => s.settings.trayClose);
  const theme = useStore(data, (s) => s.settings.theme);
  const autostart = useStore(system, (s) => s.autostart);

  return (
    <Panel title="系统集成" description="和 Windows 的配合方式：接管范围、局域网共享、开机自启、托盘和外观。">
      <FormSection>
        <ScopeField />
        <SwitchField
          id="system-proxy"
          label="系统代理"
          hint="不需要开启：应用分流和整机全局都用虚拟网卡接管流量，只认系统代理的程序也会被正常分流"
          checked={false}
          disabled
          onChange={() => undefined}
        />
        <SwitchField
          id="lan-share"
          label="对局域网开放"
          hint="手机 / 平板也能连本机代理（重启内核生效）"
          checked={lanShare}
          onChange={(on) => save({ lanShare: on })}
        />
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
      {lanShare ? <LanShareFields /> : null}
    </Panel>
  );
}
