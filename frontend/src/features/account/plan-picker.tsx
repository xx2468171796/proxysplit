// 选套餐：权益对比 + 普通 / 超级会员分组卡片 + 永久宽卡；加载中 / 读取失败 / 没有套餐三种状态。
// 会员闸门整页和会员中心弹框共用。
import { Button, InlineAlert, Note, StatePanel } from "@ankotti/admin-ui";
import { TiltCard } from "@ankotti/admin-ui/motion";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import type { MemberPlan } from "../../api/types";
import { useStore } from "../../shared/store";
import { groupPlans, license, loadCommerce } from "../../state/account";
import { BenefitTable } from "../member/benefit-table";
import { LifetimePlanCard, PlanCard } from "./plan-card";

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
  const free = useStore(license, (s) => s.status.freeDevices ?? 1);

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
        <PlanGroup
          title="普通会员"
          note={`适合个人日常使用，共 ${free + (groups.standard[0]?.maxDevices ?? 3)} 台设备`}
          plans={groups.standard}
        />
        <PlanGroup
          title="超级会员"
          note={`功能与普通会员一致，共 ${free + (groups.premium[0]?.maxDevices ?? 8)} 台设备`}
          plans={groups.premium}
        />
      </div>
      {groups.lifetime.map((p) => (
        <LifetimePlanCard key={p.id} plan={p} />
      ))}
    </div>
  );
}
