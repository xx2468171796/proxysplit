// 订阅高级选项（参照 v2rayN）：User-Agent、节点名包含 / 排除、自动更新间隔。
import { FormField, FormSection, Input } from "@ankotti/admin-ui";
import type { Sub, SubOptions } from "../../api/types";

export const subOptionsOf = (sub?: Sub): SubOptions => ({
  userAgent: sub?.userAgent ?? "",
  include: sub?.include ?? "",
  exclude: sub?.exclude ?? "",
  intervalMin: sub?.intervalMin ?? 0,
});

export const sameOptions = (a: SubOptions, b: SubOptions) =>
  a.userAgent === b.userAgent && a.include === b.include && a.exclude === b.exclude && a.intervalMin === b.intervalMin;

export function SubOptionsFields({ value, onChange }: { value: SubOptions; onChange: (v: SubOptions) => void }) {
  const set = (patch: Partial<SubOptions>) => onChange({ ...value, ...patch });
  return (
    <FormSection title="高级（可不填）">
      <FormField label="只保留名字含" htmlFor="sub-include" hint="例如 香港|HK|日本，多个用 | 分隔，不区分大小写">
        <Input id="sub-include" value={value.include} onChange={(e) => set({ include: e.target.value })} />
      </FormField>
      <FormField label="去掉名字含" htmlFor="sub-exclude" hint="例如 剩余流量|到期|官网">
        <Input id="sub-exclude" value={value.exclude} onChange={(e) => set({ exclude: e.target.value })} />
      </FormField>
      <FormField label="User-Agent" htmlFor="sub-ua" hint="机场只认某个客户端时填，如 v2rayN/7.0；留空 = 默认">
        <Input id="sub-ua" value={value.userAgent} onChange={(e) => set({ userAgent: e.target.value })} mono />
      </FormField>
      <FormField label="自动更新间隔（分钟）" htmlFor="sub-interval" hint="0 = 每 6 小时；最短 10 分钟">
        <Input
          id="sub-interval"
          type="number"
          min={0}
          value={String(value.intervalMin)}
          onChange={(e) => set({ intervalMin: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
        />
      </FormField>
    </FormSection>
  );
}
