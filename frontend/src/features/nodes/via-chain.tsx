// 前置代理示意图：本机 → （前置节点）→ 目标节点 → 网站，一眼看清流量怎么走。
import { ArrowRight, Globe, Monitor, Server } from "lucide-react";

function Hop({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub?: string; accent?: boolean }) {
  return (
    <div className={accent ? "ps-via-hop ps-via-hop--front" : "ps-via-hop"}>
      {icon}
      <b>{title}</b>
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}

export function ViaChain({ target, front }: { target: string; front?: string }) {
  const arrow = <ArrowRight className="ps-via-arrow" aria-hidden />;
  return (
    <div
      className="ps-via-chain"
      role="img"
      aria-label={front ? `本机 → ${front} → ${target} → 网站` : `本机 → ${target} → 网站`}
    >
      <Hop icon={<Monitor />} title="本机" />
      {arrow}
      {front ? (
        <>
          <Hop icon={<Server />} title={front} sub="前置节点" accent />
          {arrow}
        </>
      ) : null}
      <Hop icon={<Server />} title={target} sub="目标节点" />
      {arrow}
      <Hop icon={<Globe />} title="网站" sub="出口 IP = 目标节点" />
    </div>
  );
}
