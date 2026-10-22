// 假接口（只在开发预览和评审包里装，见 main.tsx）：拦下 /v1/*，本地没有 API 也能看全各种状态。
// 地址参数切状态：?plans=loading|error|empty、?register=fail、?version=none；开发时 ?mock=0 改走 vite 代理的真接口。
// 套餐是演示数据，不代表线上价格。
import type { Plan } from "../api";
import { siteQuery } from "../query";

const DAY = 86_400_000;

const PLANS: Plan[] = [
  { code: "demo-month", name: "普通会员 · 月卡", tier: "standard", priceCents: 1590, durationDays: 30, maxDevices: 3 },
  {
    code: "demo-quarter",
    name: "普通会员 · 季卡",
    tier: "standard",
    priceCents: 3990,
    originalPriceCents: 4770,
    durationDays: 90,
    maxDevices: 3,
    saleEndsAt: new Date(Date.now() + 2 * DAY + 3_600_000).toISOString(),
  },
  {
    code: "demo-premium-year",
    name: "超级会员 · 年卡",
    tier: "premium",
    priceCents: 16800,
    durationDays: 365,
    maxDevices: 8,
    badge: "演示数据",
    description: "预览用的假套餐，线上以接口为准。",
    purchaseLimitPerUser: 1,
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function respond(path: string, q: URLSearchParams): Promise<Response> | Response {
  if (path === "/v1/releases/latest")
    return q.get("version") === "none" ? json({}, 404) : json({ release: { version: "1.9.80" } });
  if (path === "/v1/catalog/plans") {
    const mode = q.get("plans");
    if (mode === "loading") return new Promise<Response>(() => undefined);
    if (mode === "error") return json({ error: { message: "mock" } }, 503);
    return json({ items: mode === "empty" ? [] : PLANS });
  }
  if (path === "/v1/auth/register/web")
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve(
            q.get("register") === "fail"
              ? json({ error: { message: "这个用户名已经被注册了。" } }, 409)
              : json({ ok: true }),
          ),
        600,
      ),
    );
  return new Response(null, { status: 204 });
}

export function installMockApi(): void {
  const q = siteQuery();
  if (import.meta.env.DEV && q.get("mock") === "0") return;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith("/") ? url.split("?")[0] : new URL(url).pathname;
    if (!path?.startsWith("/v1/")) return real(input, init);
    return Promise.resolve(respond(path, q));
  };
  console.info("[mock] /v1/* 使用假接口");
}
