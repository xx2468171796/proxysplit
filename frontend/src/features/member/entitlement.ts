// 权益计算（纯函数）：设备名额 = 免费名额 + 套餐设备数；云端配置份数按档位；最低价按档位。
import type { MemberPlan } from "../../api/types";
import type { LicenseStatus } from "../../api/types-account";

/** 云端配置份数（服务端 PROFILE_QUOTA 同口径；列表接口会回实际配额，这里只用于介绍页）。 */
export const PROFILE_QUOTA = { free: 0, standard: 1, premium: 5 } as const;

export type DeviceSplit = { free: number; plan: number; total: number };

export function deviceSplit(s: LicenseStatus): DeviceSplit {
  const free = s.freeDevices ?? 1;
  const total = s.maxDevices || free;
  const plan = s.planDevices ?? Math.max(0, total - free);
  return { free, plan, total };
}

/** 「1 + 3 = 4 台」；没有套餐设备时「1 台」。 */
export function devicesText(free: number, plan: number): string {
  return plan > 0 ? `${free} + ${plan} = ${free + plan} 台` : `${free} 台`;
}

export function tierLabel(s: LicenseStatus): string {
  if (!s.member) return "免费版";
  if (s.tier === "premium") return "超级会员";
  if (s.tier === "admin") return "管理员";
  return "普通会员";
}

export function cheapest(plans: readonly MemberPlan[], tier: string): MemberPlan | undefined {
  return plans
    .filter((p) => p.tier === tier && !p.lifetime)
    .reduce<MemberPlan | undefined>((best, p) => (!best || p.priceCents < best.priceCents ? p : best), undefined);
}

export function priceFrom(plan: MemberPlan | undefined): string {
  return plan ? `¥${(plan.priceCents / 100).toFixed(2)} 起` : "以套餐为准";
}
