// 权益对比：免费版 / 普通会员 / 超级会员。设备 = 免费名额 + 套餐设备数，价格和设备数都从后台套餐实时读。
import { CompactTable, Note } from "@ankotti/admin-ui";
import { useMemo } from "react";
import type { MemberPlan } from "../../api/types";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { cheapest, devicesText, PROFILE_QUOTA, priceFrom } from "./entitlement";

type BenefitRow = { id: string; item: string; free: string; standard: string; premium: string };

// CompactTable 的字段类型没从包根导出，从组件签名取。
type BenefitFields = Parameters<typeof CompactTable<BenefitRow>>[0]["fields"];

const FIELDS: BenefitFields = [
  { key: "item", title: "权益项目", type: "text", primary: true },
  { key: "free", title: "免费版", type: "text" },
  { key: "standard", title: "普通会员", type: "text" },
  { key: "premium", title: "超级会员", type: "text" },
];

export function benefitRows(free: number, standard?: MemberPlan, premium?: MemberPlan): BenefitRow[] {
  const all = (id: string, item: string, v: string) => ({ id, item, free: v, standard: v, premium: v });
  return [
    {
      id: "devices",
      item: "同时在线设备",
      free: devicesText(free, 0),
      standard: devicesText(free, standard?.maxDevices ?? 3),
      premium: devicesText(free, premium?.maxDevices ?? 8),
    },
    all("features", "代理、分流、端口代理等全部功能", "✓"),
    all("export", "本地导出 / 导入配置", "✓"),
    { id: "sync", item: "登录后自动云同步配置", free: "—", standard: "✓", premium: "✓" },
    {
      id: "profiles",
      item: "云端保存多份配置 / 分享给朋友",
      free: "—",
      standard: `${PROFILE_QUOTA.standard} 份`,
      premium: `${PROFILE_QUOTA.premium} 份`,
    },
    { id: "price", item: "价格", free: "免费", standard: priceFrom(standard), premium: priceFrom(premium) },
  ];
}

export function BenefitTable({ plans }: { plans: readonly MemberPlan[] }) {
  const free = useStore(license, (s) => s.status.freeDevices ?? 1);
  const rows = useMemo(() => benefitRows(free, cheapest(plans, "standard"), cheapest(plans, "premium")), [plans, free]);
  return (
    <section>
      <div className="ps-plan-group-head">
        <b>免费版与会员</b>
        <Note>功能一样齐全；会员多绑设备，并能把配置自动同步到云端</Note>
      </div>
      <CompactTable caption="会员权益对比" rows={rows} getRowId={(r) => r.id} fields={FIELDS} expandRecord={false} />
    </section>
  );
}
