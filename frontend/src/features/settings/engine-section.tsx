// 分流引擎：接管方式 + 几个开关，改了立即保存（部分会重启内核）。
import { FormField, FormSection, Panel, SegmentedControl } from "@ankotti/admin-ui";
import type { Settings } from "../../api/types";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { SwitchField, useSaveSettings } from "./setting-fields";

type Key = "blockQUIC" | "remoteDNS" | "privateDirect" | "excludeSelf";
type Capture = "tun" | "process";

const ITEMS: { key: Key; label: string; hint: string }[] = [
  {
    key: "blockQUIC",
    label: "阻止 QUIC 协议",
    hint: "部分浏览器 / 视频用的新加密协议，不挡住会绕过分流导致代理失效。建议开",
  },
  { key: "remoteDNS", label: "远程解析域名", hint: "把域名交给节点解析，防止运营商劫持 / 污染。建议开" },
  { key: "privateDirect", label: "内网直连", hint: "访问路由器 / NAS / 公司内网这类本地地址时不走代理。建议开" },
  { key: "excludeSelf", label: "代理程序自身不走代理", hint: "避免流量绕圈 / 死循环。建议开" },
];

const asCapture = (v: string | undefined): Capture => (v === "process" ? "process" : "tun");

export function EngineSection() {
  const settings = useStore(data, (s) => s.settings);
  const save = useSaveSettings();
  return (
    <Panel className="qd-pane" title="分流引擎" description="这几项都建议保持开启；改了立即生效。">
      <FormSection>
        <FormField
          label="接管方式"
          htmlFor="engine-capture"
          hint="仅接管选中程序：只有名单里的程序经过本软件，其它程序完全不受影响、内核重启也不断线（推荐直播、游戏用户）。只在「按应用分流」下生效；开着 AI 强制走线路时仍用整机虚拟网卡"
        >
          <SegmentedControl<Capture>
            label="接管方式"
            size="sm"
            value={asCapture(settings.captureMode)}
            onValueChange={(v) => save({ captureMode: v })}
            options={[
              { value: "tun", label: "整机虚拟网卡" },
              { value: "process", label: "仅接管选中程序（推荐直播、游戏用户）" },
            ]}
          />
        </FormField>
        <SwitchField
          id="engine-streamDirect"
          label="推流程序默认直连"
          hint="仅在「仅接管选中程序」下生效：抖音 / 快手直播伴侣、B站直播姬、OBS 没加进名单时一律直连，推流不绕节点；自己把它们加进名单则按名单走"
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
      </FormSection>
    </Panel>
  );
}
