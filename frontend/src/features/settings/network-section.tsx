// 网络与接管：代理范围、接管方式、推流直连、几个建议开着的开关、局域网共享（原「系统集成」+「分流引擎」合并）。
import { FormField, FormSection, Panel, SegmentedControl } from "@ankotti/admin-ui";
import { useState } from "react";
import type { Settings } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data, saveSettings } from "../../state/data";
import { LanShareFields } from "./lan-share-fields";
import { SwitchField, useSaveSettings } from "./setting-fields";

type Scope = "split" | "tun";
type Capture = "tun" | "process";
type Key = "blockQUIC" | "remoteDNS" | "privateDirect" | "excludeSelf";

const ITEMS: { key: Key; label: string; hint: string }[] = [
  { key: "blockQUIC", label: "阻止 QUIC 协议", hint: "部分浏览器 / 视频用的新协议，不挡住会绕过分流。建议开" },
  { key: "remoteDNS", label: "远程解析域名", hint: "把域名交给节点解析，防止运营商劫持 / 污染。建议开" },
  { key: "privateDirect", label: "内网直连", hint: "访问路由器 / NAS / 公司内网时不走代理。建议开" },
  { key: "excludeSelf", label: "代理程序自身不走代理", hint: "避免流量绕圈 / 死循环。建议开" },
];

const asCapture = (v: string | undefined): Capture => (v === "process" ? "process" : "tun");

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
    <FormField
      label="代理范围"
      htmlFor="proxy-scope"
      hint={switching ? "切换中…" : "两种都用虚拟网卡接管，不需要再开 Windows 系统代理"}
    >
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

export function NetworkSection() {
  const settings = useStore(data, (s) => s.settings);
  const save = useSaveSettings();
  return (
    <Panel
      className="qd-pane"
      title="网络与接管"
      description="流量怎么进到本软件；下面几个开关建议保持开启，改了立即生效。"
    >
      <FormSection>
        <ScopeField />
        <FormField
          label="接管方式"
          htmlFor="engine-capture"
          hint="仅接管选中程序：只有名单里的程序经过本软件，内核重启也不断线。只在「应用分流」下生效；开着 AI 劫持时仍用整机虚拟网卡"
        >
          <SegmentedControl<Capture>
            label="接管方式"
            size="sm"
            value={asCapture(settings.captureMode)}
            onValueChange={(v) => save({ captureMode: v })}
            options={[
              { value: "tun", label: "整机虚拟网卡" },
              { value: "process", label: "仅接管选中程序" },
            ]}
          />
        </FormField>
        <SwitchField
          id="engine-streamDirect"
          label="推流程序默认直连"
          hint="仅接管选中程序时：直播伴侣、直播姬、OBS 没加进名单就直连，推流不绕节点"
          checked={!settings.streamDirectOff}
          onChange={(on) => save({ streamDirectOff: !on })}
        />
        {ITEMS.map((it) => (
          <SwitchField
            key={it.key}
            id={`engine-${it.key}`}
            label={it.label}
            hint={it.hint}
            checked={settings[it.key]}
            onChange={(on) => save({ [it.key]: on } as Partial<Settings>)}
          />
        ))}
        <SwitchField
          id="lan-share"
          label="对局域网开放"
          hint="手机 / 平板也能连本机代理（重启内核生效）"
          checked={settings.lanShare}
          onChange={(on) => save({ lanShare: on })}
        />
      </FormSection>
      {settings.lanShare ? <LanShareFields /> : null}
    </Panel>
  );
}
