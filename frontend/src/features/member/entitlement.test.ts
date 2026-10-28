import { describe, expect, it } from "vitest";
import type { MemberPlan } from "../../api/types";
import type { LicenseStatus } from "../../api/types-account";
import { benefitRows } from "./benefit-table";
import { cheapest, deviceSplit, devicesText, priceFrom, tierLabel } from "./entitlement";

const base: LicenseStatus = {
  enabled: true,
  signedIn: true,
  authenticated: true,
  deviceLimitReached: false,
  username: "u",
  plan: "",
  planCode: "free",
  tier: "free",
  maxDevices: 1,
  features: [],
  expiresAt: "",
  offlineUntil: "",
};

const plan = (tier: string, priceCents: number, maxDevices: number): MemberPlan => ({
  id: `${tier}-${priceCents}`,
  code: tier,
  name: tier,
  description: "",
  tier,
  billingCycle: "month",
  lifetime: false,
  priceCents,
  currency: "CNY",
  maxDevices,
  features: [],
  badge: "",
});

describe("entitlement", () => {
  it("splits devices into free + plan slots", () => {
    expect(
      deviceSplit({ ...base, member: true, tier: "premium", maxDevices: 9, freeDevices: 1, planDevices: 8 }),
    ).toEqual({ free: 1, plan: 8, total: 9 });
    expect(deviceSplit(base)).toEqual({ free: 1, plan: 0, total: 1 });
    expect(devicesText(1, 3)).toBe("1 + 3 = 4 台");
    expect(devicesText(1, 0)).toBe("1 台");
  });

  it("labels tiers and finds the cheapest price", () => {
    expect(tierLabel(base)).toBe("免费版");
    expect(tierLabel({ ...base, member: true, tier: "standard" })).toBe("普通会员");
    const plans = [plan("standard", 1900, 3), plan("standard", 990, 3), plan("premium", 2990, 8)];
    expect(cheapest(plans, "standard")?.priceCents).toBe(990);
    expect(priceFrom(undefined)).toBe("以套餐为准");
  });

  it("compares free vs members with stacked devices and sync", () => {
    const rows = benefitRows(1, plan("standard", 990, 3), plan("premium", 2990, 8));
    const devices = rows.find((r) => r.id === "devices");
    expect(devices).toMatchObject({ free: "1 台", standard: "1 + 3 = 4 台", premium: "1 + 8 = 9 台" });
    expect(rows.find((r) => r.id === "sync")).toMatchObject({ free: "—", standard: "✓" });
    expect(rows.find((r) => r.id === "profiles")).toMatchObject({ standard: "1 份", premium: "5 份" });
  });
});
