// 官网单页：首屏 → 协议 → 功能 → 步骤 → 会员 → 须知 → 常见问题。
import { useEffect } from "react";
import { trackView } from "./api";
import { Features, ProtocolStrip } from "./sections/features";
import { Hero, SiteHeader } from "./sections/hero";
import { Faq, Notice, SiteFooter, Steps } from "./sections/info";
import { Pricing } from "./sections/pricing";
import { useLatestVersion } from "./use-site-data";

export function App() {
  const version = useLatestVersion();
  useEffect(trackView, []);
  return (
    <>
      <SiteHeader />
      <main>
        <Hero version={version} />
        <ProtocolStrip />
        <Features />
        <Steps />
        <Pricing />
        <Notice />
        <Faq />
      </main>
      <SiteFooter version={version} />
    </>
  );
}
