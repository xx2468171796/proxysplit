// 页面要的两份服务端数据：最新版本号、套餐列表。各取一次，挂载即开始，卸载后不再写状态。
import { useEffect, useState } from "react";
import { fetchLatestVersion, fetchPlans, type Plan } from "./api";

export function useLatestVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fetchLatestVersion().then((v) => {
      if (live) setVersion(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return version;
}

export type PlansState = { status: "loading" } | { status: "error" } | { status: "ready"; plans: Plan[] };

export function usePlans(): PlansState {
  const [state, setState] = useState<PlansState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    fetchPlans().then(
      (plans) => live && setState({ status: "ready", plans }),
      () => live && setState({ status: "error" }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** 限时优惠剩余毫秒；没有或已过期返回 null。每秒刷新，结束后停表。 */
export function useCountdown(endsAt: string | undefined): number | null {
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());
  const live = Number.isFinite(end) && end > now;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return live ? end - now : null;
}
