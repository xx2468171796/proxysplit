// 选套餐：权益对比 + 普通 / 超级会员分组卡片 + 永久宽卡；加载中 / 读取失败 / 没有套餐三种状态。
// 会员闸门整页和会员中心弹框共用。
import { Button, CompactTable, InlineAlert, Note, StatePanel } from "@ankotti/admin-ui";
import { TiltCard } from "@ankotti/admin-ui/motion";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import type { MemberPlan } from "../../api/types";
import { useStore } from "../../shared/store";
import { groupPlans, license, loadCommerce } from "../../state/account";
import { LifetimePlanCard, PlanCard } from "./plan-card";

type BenefitRow = { id: string; item: string; standard: string; premium: string };

// CompactTable 的字段类型没从包根导出，从组件签名取。
type BenefitFields = Parameters<typeof CompactTable<BenefitRow>>[0]["fields"];

const BENEFIT_FIELDS: BenefitFields = [
  { key: "item", title: "权益项目", type: "text", primary: true },
  { key: "standard", title: "普通会员", type: "text" },
  { key: "premium", title: "超级会员", type: "text" },
];

function benefitRows(standard?: MemberPlan, premium?: MemberPlan): BenefitRow[] {
  const same = (id: string, item: string, v: string) => ({ id, item, standard: v, premium: v });
  return [
    {
      id: "devices",
      item: "同时在线设备",
      standard: `${standard?.maxDevices || 3} 台`,
      premium: `${premium?.maxDevices || 8} 台`,
    },
    same("proto", "代理协议", "全部支持"),
    same("apps", "应用分流规则", "支持"),
    same("lines", "自定义线路", "支持"),
    same("features", "功能权益", "完整功能"),
  ];
}

function BenefitTable({ plans }: { plans: readonly MemberPlan[] }) {
  const rows = useMemo(
    () =>
      benefitRows(
        plans.find((p) => p.tier === "standard"),
        plans.find((p) => p.tier === "premium"),
      ),
    [plans],
  );
  return (
    <section>
      <div className="ps-plan-group-head">
        <b>普通会员与超级会员</b>
        <Note>功能与协议完全一致，仅同时在线设备数量不同</Note>
      </div>
      <CompactTable
        caption="会员权益对比"
        rows={rows}
        getRowId={(r) => r.id}
        fields={BENEFIT_FIELDS}
        expandRecord={false}
      />
    </section>
  );
}

function PlanGroup({ title, note, plans }: { title: string; note: string; plans: readonly MemberPlan[] }) {
  if (!plans.length) return null;
  return (
    <section>
      <div className="ps-plan-group-head">
        <b>{title}</b>
        <Note>
          {note} · {plans.length} 种时长可选
        </Note>
      </div>
      <div className="ps-plan-grid" data-aui-stagger="">
        {plans.map((p) => (
          <TiltCard key={p.id}>
            <PlanCard plan={p} />
          </TiltCard>
        ))}
      </div>
    </section>
  );
}

function PlanLoadError({ message }: { message: string }) {
  return (
    <InlineAlert
      tone="warning"
      title="套餐没读出来"
      action={
        <Button size="sm" variant="outline" onClick={() => void loadCommerce()}>
          <RefreshCw />
          重新读取
        </Button>
      }
    >
      {message}
    </InlineAlert>
  );
}

export function PlanPicker() {
  const plans = useStore(license, (s) => s.plans);
  const loading = useStore(license, (s) => s.loading);
  const loadError = useStore(license, (s) => s.planLoadError);
  const groups = useMemo(() => groupPlans(plans), [plans]);

  if (!plans.length) {
    if (loading) return <StatePanel kind="loading" title="正在加载套餐…" size="compact" />;
    return loadError ? (
      <PlanLoadError message={loadError} />
    ) : (
      <StatePanel
        kind="empty"
        title="暂时无法显示套餐"
        message="请检查网络后重新加载。"
        size="compact"
        action={<Button onClick={() => void loadCommerce()}>重新加载</Button>}
      />
    );
  }
  return (
    <div className="ps-plans">
      {loadError ? <PlanLoadError message={loadError} /> : null}
      <BenefitTable plans={plans} />
      <div className="ps-plan-groups">
        <PlanGroup title="普通会员" note="适合个人日常使用，支持 3 台设备" plans={groups.standard} />
        <PlanGroup title="超级会员" note="功能与普通会员一致，支持 8 台设备" plans={groups.premium} />
      </div>
      {groups.lifetime.map((p) => (
        <LifetimePlanCard key={p.id} plan={p} />
      ))}
    </div>
  );
}
