// 单个套餐卡片：标签 / 名称、说明、价格（划线原价）、要点、「立即购买」。永久套餐用宽卡。
import { Button, StatusBadge, Tag } from "@ankotti/admin-ui";
import type { MemberPlan } from "../../api/types";
import { fmtYuan } from "../../shared/format";
import { useStore } from "../../shared/store";
import { buyPlan, payment } from "../../state/payment";

function Price({ plan }: { plan: MemberPlan }) {
  const original = plan.originalPriceCents && plan.originalPriceCents > plan.priceCents ? plan.originalPriceCents : 0;
  return (
    <div className="ps-plan-price">
      <small>¥</small>
      <strong>{fmtYuan(plan.priceCents)}</strong>
      {original ? <del>¥{fmtYuan(original)}</del> : null}
    </div>
  );
}

function BuyButton({ plan }: { plan: MemberPlan }) {
  const busy = useStore(payment, (s) => s.busy);
  return (
    <Button loading={busy} loadingText="请稍候…" onClick={() => void buyPlan(plan)}>
      立即购买
    </Button>
  );
}

export function PlanCard({ plan }: { plan: MemberPlan }) {
  const premium = plan.tier === "premium";
  return (
    <article className="ps-plan-card" data-tier={plan.tier}>
      <div className="ps-plan-card-top">
        <StatusBadge tone={premium ? "brand" : "neutral"}>
          {plan.badge || (premium ? "超级会员" : "普通会员")}
        </StatusBadge>
        <Tag variant="plain" size="sm">
          {plan.maxDevices} 台设备
        </Tag>
      </div>
      <h3 className="ps-plan-name">{plan.name}</h3>
      <p className="ps-plan-desc">{plan.description || "开通后立即生效，可在有效期内持续使用。"}</p>
      <Price plan={plan} />
      <div className="ps-plan-highlights">
        {plan.durationDays || 0} 天 · {plan.maxDevices} 台设备 · {premium ? "全部功能" : "基础功能"}
      </div>
      <BuyButton plan={plan} />
    </article>
  );
}

export function LifetimePlanCard({ plan }: { plan: MemberPlan }) {
  return (
    <article className="ps-plan-card" data-tier="premium" data-wide="">
      <div className="ps-plan-wide-copy">
        <div className="ps-row">
          <StatusBadge tone="brand">{plan.badge || "限时活动"}</StatusBadge>
          <h3 className="ps-plan-name">{plan.name}</h3>
        </div>
        <p className="ps-plan-desc">{plan.description || "一次开通，长期使用超级会员全部功能。"}</p>
        <div className="ps-plan-highlights">永久有效 · {plan.maxDevices} 台设备 · 超级会员全部功能</div>
      </div>
      <div className="ps-plan-wide-buy">
        <Price plan={plan} />
        <BuyButton plan={plan} />
      </div>
    </article>
  );
}
