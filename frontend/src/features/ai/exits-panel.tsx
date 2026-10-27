// AI 页「实时出口」：本机网络 / 分应用代理 / AI 线路三条路各自的出口 IP，页面开着时每 3 秒刷新一次。
// 后端 App.GetExits（exits_app.go → internal/service/exits.go）；AI 那条只经 AI 线路代理测，绝不会用本机 IP 碰 AI 网站。
import { DescriptionList, InlineAlert, Panel, StatusBadge } from "@ankotti/admin-ui";
import { useEffect, useState } from "react";
import { api } from "../../api/backend";
import type { ExitInfo, ExitsReport } from "../../api/types";

const REFRESH_MS = 3000;
const TITLE: Record<ExitInfo["path"], string> = { direct: "本机网络出口", proxy: "分应用代理出口", ai: "AI 出口" };
const HINT: Record<ExitInfo["path"], string> = {
  direct: "不走代理的程序看到的 IP（你的真实网络）",
  proxy: "走代理的程序看到的 IP（当前节点）",
  ai: "Claude / ChatGPT 看到的 IP",
};

function useExits() {
  const [report, setReport] = useState<ExitsReport | null>(null);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const tick = async () => {
      // 窗口最小化 / 藏到托盘时不测，省流量也省 IP 查询额度
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const r = await api.exits();
        if (alive) setReport(r);
      } catch {
        // 下一轮再试
      } finally {
        busy = false;
      }
    };
    void tick();
    // admin-ui-audit-ignore short-poll: 桌面客户端读本机 Go 后端（Wails 绑定）测出的出口，实时指标按业主要求 3 秒一刷，没有推送通道
    const timer = setInterval(() => void tick(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return report;
}

function badge(e: ExitInfo) {
  if (e.state === "ok")
    return <StatusBadge tone={e.path === "ai" && !e.ours ? "warning" : "success"}>已连通</StatusBadge>;
  if (e.state === "fail") return <StatusBadge tone="danger">测不通</StatusBadge>;
  if (e.state === "off") return <StatusBadge tone="neutral">未开启</StatusBadge>;
  return <StatusBadge tone="neutral">检测中</StatusBadge>;
}

function ExitCard({ exit }: { exit: ExitInfo }) {
  const where = [exit.country, exit.city].filter(Boolean).join(" · ");
  return (
    <Panel
      className="qd-pane ps-exit-card"
      title={TITLE[exit.path]}
      description={HINT[exit.path]}
      actions={badge(exit)}
    >
      <div className="ps-exit-ip ps-mono">{exit.state === "ok" ? exit.ip : "—"}</div>
      {exit.state === "ok" ? (
        <DescriptionList
          layout="stacked"
          columns={2}
          items={[
            { label: "地区", value: where || "未知" },
            { label: "类型", value: exit.kind || "查询中" },
            { label: "运营商", value: exit.asn || "查询中", full: true },
            { label: "线路", value: exit.via || "—" },
            { label: "延迟", value: exit.latencyMs ? `${exit.latencyMs} ms` : "—" },
            ...(exit.path === "direct" ? [] : [{ label: "POWER云 官方", value: exit.ours ? "是" : "否" }]),
          ]}
        />
      ) : (
        <p className="ps-exit-note">{exit.detail || "检测中…"}</p>
      )}
    </Panel>
  );
}

/** 一句话结论：AI 有没有走对出口。 */
function Verdict({ r }: { r: ExitsReport }) {
  const { ai, direct, proxy } = r;
  if (ai.state === "ok" && direct.state === "ok" && ai.ip === direct.ip)
    return (
      <InlineAlert tone="error" density="compact" title="AI 出口和本机网络一样">
        AI 正在用你的真实 IP 访问，有封号风险。去下面「AI 环境检测」开启劫持或检查线路。
      </InlineAlert>
    );
  if (ai.state === "ok" && ai.ours)
    return (
      <InlineAlert tone="success" density="compact" title="AI 走 POWER云 官方线路">
        AI 出口 {ai.ip}
        {ai.country ? `（${ai.country}）` : ""}
        {proxy.state === "ok" && proxy.ip !== ai.ip ? "，和分应用代理是不同出口，互不影响。" : "。"}
      </InlineAlert>
    );
  if (ai.state === "ok")
    return (
      <InlineAlert tone="warning" density="compact" title="AI 走的不是官方线路">
        AI 出口 {ai.ip} 是你自己的节点，可以用，但出口质量和账号安全我们没法保证。
      </InlineAlert>
    );
  if (ai.state === "fail")
    return (
      <InlineAlert tone="warning" density="compact" title="AI 线路测不通">
        {ai.detail} 这时 AI 打不开，但不会走本机网络。
      </InlineAlert>
    );
  return null;
}

export function ExitsPanel() {
  const r = useExits();
  const pending: ExitInfo = { path: "direct", state: "", ours: false };
  const time = r?.checkedAt ? new Date(r.checkedAt).toLocaleTimeString() : "";
  return (
    <section className="ps-stack" aria-label="实时出口">
      <div className="ps-exit-head">
        <h2>实时出口 IP</h2>
        <span>{time ? `每 3 秒刷新 · 最后更新 ${time}` : "检测中…"}</span>
      </div>
      {r ? <Verdict r={r} /> : null}
      <div className="ps-exit-grid">
        <ExitCard exit={r?.direct ?? pending} />
        <ExitCard exit={r?.proxy ?? { ...pending, path: "proxy" }} />
        <ExitCard exit={r?.ai ?? { ...pending, path: "ai" }} />
      </div>
    </section>
  );
}
