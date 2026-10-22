// 一张套餐卡：名称、价格（有原价时划掉）、限时倒计时、权益。付款在客户端里完成，这里只引导下载。
import { Card } from "qiantai";
import { LATEST_DOWNLOAD, type Plan, yuan } from "../api";
import { useCountdown } from "../use-site-data";

const pad = (n: number) => String(n).padStart(2, "0");

function Countdown({ endsAt }: { endsAt: string }) {
  const left = useCountdown(endsAt);
  if (left === null) return <p className="ps-sale is-ended">优惠已结束</p>;
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const text = `${d > 0 ? `${d} 天 ` : ""}${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return (
    <p className="ps-sale" role="timer">
      限时优惠，还剩 <b>{text}</b>
    </p>
  );
}

export function PlanCard({ plan }: { plan: Plan }) {
  const premium = plan.tier === "premium";
  const original = Number(plan.originalPriceCents ?? 0);
  const period = plan.lifetime ? "永久有效" : `${plan.durationDays ?? 0} 天`;
  return (
    <Card kind="lift" className={`ps-plan${premium ? " is-premium" : ""}`}>
      <span className="q-chip">
        {plan.badge || (premium ? "超级会员" : "普通会员")} · {plan.maxDevices} 台设备
      </span>
      <h3>{plan.name}</h3>
      <p className="ps-price">
        <small>¥</small>
        {yuan(plan.priceCents)}
        {original > plan.priceCents ? <del>¥{yuan(original)}</del> : null}
      </p>
      {plan.saleEndsAt ? <Countdown endsAt={plan.saleEndsAt} /> : null}
      {plan.description ? <p className="q-muted ps-plan-desc">{plan.description}</p> : null}
      <ul>
        <li>{period}</li>
        <li>最多 {plan.maxDevices} 台电脑同时使用</li>
        {plan.purchaseLimitPerUser ? <li>每人限购 {plan.purchaseLimitPerUser} 次</li> : null}
      </ul>
      <a className={`q-btn${premium ? "" : " ghost"}`} href={LATEST_DOWNLOAD}>
        下载后在软件里开通
      </a>
    </Card>
  );
}
