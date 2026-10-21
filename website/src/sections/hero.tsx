// 页头 + 首屏：一句话说清产品，下载按钮，下面是真实界面截图。背景是很淡的波浪线（呼应「网络路径」），不用光晕。
import { Button } from "@ankotti/admin-ui";
import { Waves } from "dongxiao/backgrounds/waves";
import { Magnet } from "dongxiao/interactions/magnet";
import { BlurText } from "dongxiao/text/blur-text";
import { LATEST_DOWNLOAD } from "../api";
import { useMotion } from "../site/motion-context";
import { useTokens } from "../site/theme-provider";
import { withAlpha } from "../site/tokens";
import { Screenshot } from "./screenshot";

const NAV = [
  { href: "#features", label: "功能" },
  { href: "#pricing", label: "会员" },
  { href: "#faq", label: "常见问题" },
  { href: "#notice", label: "使用须知" },
] as const;

export function SiteHeader() {
  return (
    <header className="ps-header">
      <div className="ps-wrap ps-header-row">
        <a className="ps-brand" href="/" aria-label="ProxySplit 首页">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>ProxySplit</span>
        </a>
        <nav className="ps-nav" aria-label="主导航">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <Button asChild size="sm">
          <a href={LATEST_DOWNLOAD}>下载</a>
        </Button>
      </div>
    </header>
  );
}

export function Hero({ version }: { version: string | null }) {
  const { paused } = useMotion();
  const tokens = useTokens();
  return (
    <section className="ps-hero">
      <Waves
        className="ps-hero-waves"
        lineColor={withAlpha(tokens.text, 0.06)}
        waveSpeedX={0.008}
        waveSpeedY={0.004}
        waveAmpX={28}
        waveAmpY={14}
        xGap={30}
        yGap={44}
        paused={paused}
      />
      <div className="ps-wrap ps-hero-copy">
        <p className="ps-eyebrow">Windows 10 / 11{version ? ` · 当前版本 v${version}` : ""}</p>
        <h1 className="ps-hero-title">
          <BlurText text="每个程序，" animateBy="letters" delay={45} paused={paused} />
          <BlurText text="走自己的网络。" animateBy="letters" delay={45} paused={paused} />
        </h1>
        <p className="ps-lead">
          浏览器走代理、微信直连、某个工具单独走一条线路 ——
          在一张列表里设好，马上生效。节点、规则和配置都保存在你自己的电脑上。
        </p>
        <div className="ps-hero-actions">
          <Magnet magnetStrength={6} padding={40} paused={paused}>
            <Button asChild size="lg">
              <a href={LATEST_DOWNLOAD}>下载 Windows 版</a>
            </Button>
          </Magnet>
          <Button asChild size="lg" variant="ghost">
            <a href="#features">看看怎么用</a>
          </Button>
        </div>
        <p className="ps-hero-notes">新用户免费试用 3 天 · 单个 exe，不用安装 · 更新包签名校验</p>
      </div>
      <div className="ps-wrap ps-hero-shot">
        <Screenshot name="overview" alt="ProxySplit 概览页：运行状态、分流链路、各程序的流量和节点健康" eager />
      </div>
    </section>
  );
}
