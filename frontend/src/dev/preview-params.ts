// 预览 / 评审包专用的地址参数（只在装假后端时调用）：
// ?page=<页面 id> 打开指定页（&tab=<分区 id> 切到合并页的某个分区）；?look=1 打开「外观」面板；?donate=0 赞赏码倒计时一结束就替人点关闭（截图不被挡）。

import { navigate, type PageId, type PageTab } from "../app/nav";
import { previewSearch } from "./search";

const PAGE_IDS: readonly PageId[] = ["overview", "ai", "nodes", "apps", "rules", "logs", "settings"];
const PAGE_TABS: readonly PageTab[] = [
  "nodes",
  "subs",
  "apps",
  "ports",
  "conns",
  "logs",
  "diag",
  "env",
  "accel",
  "control",
];

/** 每 100ms 找一次目标，找到就点，最多等 limitMs。 */
function clickWhenReady(find: () => HTMLButtonElement | null | undefined, limitMs: number, then?: () => void): void {
  let waited = 0;
  const timer = setInterval(() => {
    waited += 100;
    const btn = find();
    if (btn && !btn.disabled) {
      clearInterval(timer);
      btn.click();
      then?.();
    } else if (waited > limitMs) clearInterval(timer);
  }, 100);
}

const donateClose = () =>
  [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((b) =>
    b.textContent?.includes("我知道了"),
  );

export function applyPreviewParams(): void {
  const params = new URLSearchParams(previewSearch());
  const page = PAGE_IDS.find((p) => p === params.get("page"));
  const tab = PAGE_TABS.find((t) => t === params.get("tab")) ?? null;
  if (page) navigate(page, null, tab);
  const openLook = () => clickWhenReady(() => document.querySelector<HTMLButtonElement>(".qd-look"), 5000);
  if (params.get("donate") === "0")
    clickWhenReady(donateClose, 8000, params.get("look") === "1" ? openLook : undefined);
  else if (params.get("look") === "1") openLook();
}
