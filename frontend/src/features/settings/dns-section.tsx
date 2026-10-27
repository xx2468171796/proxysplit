// DNS 与高级网络（参照 v2rayN）：国内 / 国外 DNS、自定义 hosts、拦截 HTTPS/SVCB 记录、虚拟网卡 MTU、严格路由。
// 文本框要手动点保存（Go 先校验）；空着 = 内置默认。
import { Button, FormField, FormSection, Input, Panel, Switch, Textarea } from "@ankotti/admin-ui";
import { useState } from "react";
import type { NetSettings } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data, saveNetSettings } from "../../state/data";

export function DNSSection() {
  const { say } = useFeedback();
  const saved = useStore(data, (s) => s.settings.net) ?? {};
  const [v, setV] = useState<NetSettings>(saved);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<NetSettings>) => setV({ ...v, ...patch });
  const save = async () => {
    setBusy(true);
    const err = await saveNetSettings(v);
    setBusy(false);
    say(err ? `保存失败：${err}` : "已保存，内核已按新设置重启", err ? "error" : undefined);
  };
  return (
    <Panel
      className="qd-pane"
      title="DNS 与高级网络"
      description="一般不用改；空着就用内置默认。保存后内核会重启一次。"
    >
      <FormSection>
        <FormField
          label="国内 DNS"
          htmlFor="dns-direct"
          hint="直连解析国内域名，默认 223.5.5.5（阿里）；可填 119.29.29.29（腾讯）"
        >
          <Input
            id="dns-direct"
            mono
            placeholder="223.5.5.5"
            value={v.dnsDirect ?? ""}
            onChange={(e) => set({ dnsDirect: e.target.value })}
          />
        </FormField>
        <FormField label="国外 DNS" htmlFor="dns-remote" hint="经节点解析国外域名，默认 8.8.8.8；可填 1.1.1.1">
          <Input
            id="dns-remote"
            mono
            placeholder="8.8.8.8"
            value={v.dnsRemote ?? ""}
            onChange={(e) => set({ dnsRemote: e.target.value })}
          />
        </FormField>
        <FormField
          label="自定义 hosts"
          htmlFor="dns-hosts"
          hint="每行「域名 IP」，如 nas.home 192.168.1.10；# 开头是注释"
        >
          <Textarea id="dns-hosts" rows={4} value={v.hosts ?? ""} onChange={(e) => set({ hosts: e.target.value })} />
        </FormField>
        <FormField label="拦截 HTTPS / SVCB 记录" htmlFor="dns-block-https" hint="个别网站在浏览器里打不开或很慢时再开">
          <Switch id="dns-block-https" checked={!!v.blockHttpsRR} onCheckedChange={(on) => set({ blockHttpsRR: on })} />
        </FormField>
        <FormField label="虚拟网卡 MTU" htmlFor="tun-mtu" hint="0 = 1500；网页常卡住转圈可试 1400">
          <Input
            id="tun-mtu"
            type="number"
            min={0}
            value={String(v.tunMtu ?? 0)}
            onChange={(e) => set({ tunMtu: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
        </FormField>
        <FormField
          label="严格路由"
          htmlFor="tun-strict"
          hint="防止流量绕过虚拟网卡，建议开；个别虚拟机 / VPN 软件冲突时再关"
        >
          <Switch id="tun-strict" checked={!v.strictRouteOff} onCheckedChange={(on) => set({ strictRouteOff: !on })} />
        </FormField>
      </FormSection>
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        保存
      </Button>
    </Panel>
  );
}
