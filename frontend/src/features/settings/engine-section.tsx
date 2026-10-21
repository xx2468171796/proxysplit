// 分流引擎：四个开关，改了立即保存（部分会重启内核）。
import { FormSection, Panel } from "@ankotti/admin-ui";
import type { Settings } from "../../api/types";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { SwitchField, useSaveSettings } from "./setting-fields";

type Key = "blockQUIC" | "remoteDNS" | "privateDirect" | "excludeSelf";

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

export function EngineSection() {
  const settings = useStore(data, (s) => s.settings);
  const save = useSaveSettings();
  return (
    <Panel title="分流引擎" description="这几项都建议保持开启；改了立即生效。">
      <FormSection>
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
