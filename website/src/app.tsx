// 官网单页：qiantai 配方（recipe.ts）+ actions（按钮 / 导航去哪）+ slots（接口拉的实时内容和真截图）。
import { parseRecipe, type SiteActions, SiteView } from "qiantai";
import { useEffect, useMemo } from "react";
import { LATEST_DOWNLOAD, MAC_DOWNLOAD, trackView } from "./api";
import { siteQuery } from "./query";
import { LABEL, siteRecipe } from "./recipe";
import { DownloadSlot } from "./slots/download";
import { PricingSlot } from "./slots/pricing";
import { PreviewSlot } from "./slots/shot";
import { TourSlot } from "./slots/tour";
import { useLatestVersion } from "./use-site-data";

/** 配方里的按钮 / 导航 / 页脚文字 → 去哪。下载一律走带访客统计的 latest 地址。 */
const ACTIONS: SiteActions = {
  [LABEL.download]: LATEST_DOWNLOAD,
  [LABEL.downloadMac]: MAC_DOWNLOAD,
  // 导航「下载」跳到下载区，两个平台都在那里
  [LABEL.navDownload]: "#download",
  [LABEL.tour]: "#features",
  [LABEL.features]: "#features",
  [LABEL.pricing]: "#pricing",
  [LABEL.faq]: "#faq",
  [LABEL.notice]: "#notice",
  [LABEL.qq]: "#download",
  [LABEL.wechat]: "#download",
};

const DARK = siteQuery().get("theme") === "dark";

export function App() {
  const version = useLatestVersion();
  useEffect(trackView, []);
  // 带锚点打开（/#pricing）：页面是挂载后才渲染的，浏览器自己跳不过去，这里补一次
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  const parsed = useMemo(() => parseRecipe(siteRecipe(version, DARK)), [version]);
  if (!parsed.ok) {
    console.error(parsed.message, parsed.issues);
    return <p>页面配置有误：{parsed.issues.join("；")}</p>;
  }
  return (
    <SiteView
      recipe={parsed.recipe}
      actions={ACTIONS}
      slots={{
        preview: <PreviewSlot />,
        features: <TourSlot />,
        pricing: <PricingSlot />,
        download: <DownloadSlot version={version} />,
      }}
    />
  );
}
