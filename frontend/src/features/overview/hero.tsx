// 概览顶部的连接面板：大开关（点一下启动 / 停止服务）、当前节点与延迟、已运行时长、实时上下行速率、分流方式的白话说明。
import { Button, StatusBadge } from "@ankotti/admin-ui";
import { ArrowDown, ArrowUp, Power, RefreshCw } from "lucide-react";
import type { ClashMode, RuleMode } from "../../api/types";
import { navigate } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { fmtRate, fmtUptime, latencyGrade, latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { data, reloadData } from "../../state/data";
import { AUTO_NODE_ID, AUTO_NODE_LABEL } from "../../state/nodes";
import { isRunning, refreshHealth, refreshStatus, restartCore, runtime, toggleRun } from "../../state/runtime";
import { useCountUp } from "./count-up";

const GRADE_TONE = ["danger", "warning", "warning", "success", "success"] as const;

/** 当前分流方式说人话 */
function modeText(tun: boolean, clash: ClashMode, rule: RuleMode): string {
  if (tun) return "整机全局：这台电脑上所有程序都走代理";
  if (clash === "global") return "全部代理：所有流量都走当前节点";
  if (clash === "direct") return "全部直连：暂时都不走代理";
  return rule === "whitelist"
    ? "按规则分流：只有列出的应用走代理，其余直连"
    : "按规则分流：默认都走代理，列出的应用按设置分流";
}

function Rate({ dir, bps }: { dir: "down" | "up"; bps: number }) {
  const r = fmtRate(useCountUp(bps));
  const Icon = dir === "down" ? ArrowDown : ArrowUp;
  return (
    <div className="ps-hero-rate">
      <span className="ps-hero-label">
        <Icon aria-hidden="true" />
        {dir === "down" ? "下载" : "上传"}
      </span>
      <b className="ps-mono">{r.value}</b>
      <small>{r.unit}</small>
    </div>
  );
}

function NodeLine() {
  const nodes = useStore(data, (s) => s.nodes);
  const selected = useStore(runtime, (s) => s.status?.selectedId);
  const node = nodes.find((n) => n.id === selected);
  const untested = !node?.latency || node.latency === -99;
  const auto = selected === AUTO_NODE_ID;
  return (
    <div className="ps-hero-node">
      <span className="ps-hero-label">当前节点</span>
      <b>{auto ? AUTO_NODE_LABEL : node ? node.name : "未选择"}</b>
      <span className="ps-row">
        {auto ? <StatusBadge tone="neutral">按延迟自动挑</StatusBadge> : null}
        {node ? (
          <StatusBadge tone={untested ? "neutral" : GRADE_TONE[latencyGrade(node.latency)]}>
            {latencyText(node.latency)}
          </StatusBadge>
        ) : null}
        <Button size="sm" variant="text" onClick={() => navigate("nodes")}>
          {node || auto ? "换一个" : "去选一个"}
        </Button>
      </span>
    </div>
  );
}

export function ConnectHero() {
  const { say } = useFeedback();
  const status = useStore(runtime, (s) => s.status);
  const busy = useStore(runtime, (s) => s.busy);
  const down = useStore(runtime, (s) => s.downRate);
  const up = useStore(runtime, (s) => s.upRate);
  const tun = useStore(data, (s) => s.settings.tunMode);
  const clash = useStore(data, (s) => s.clashMode);
  const rule = useStore(data, (s) => s.ruleMode);
  const running = isRunning(status);
  const conns = status?.stats?.activeConns ?? 0;
  const refresh = async () => {
    await Promise.all([reloadData(), refreshStatus(), refreshHealth()]);
    say("状态已刷新", "info");
  };

  return (
    <section className="qd-pane ps-hero" data-running={running} aria-label="连接状态">
      <div className="ps-hero-main">
        <Button
          variant="outline"
          className="ps-power"
          aria-pressed={running}
          aria-label={running ? "停止服务" : "启动服务"}
          disabled={busy}
          onClick={() => void toggleRun().then(say)}
        >
          <Power aria-hidden="true" />
        </Button>
        <div className="ps-hero-state">
          <b>{busy ? (running ? "正在停止…" : "正在启动…") : running ? "运行中" : "已停止"}</b>
          <span>
            {running ? `已运行 ${fmtUptime(status?.uptimeSec ?? 0)} · ${conns} 个连接` : "点左边的按钮开始代理"}
          </span>
          <span className="ps-hero-mode">{modeText(tun, clash, rule)}</span>
        </div>
      </div>
      <div className="ps-hero-side">
        <NodeLine />
        <div className="ps-hero-rates" data-dim={!running}>
          <Rate dir="down" bps={running ? down : 0} />
          <Rate dir="up" bps={running ? up : 0} />
        </div>
        <span className="ps-hero-tools">
          {running ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void restartCore().then((e) => say(e || "已重启"))}
            >
              <RefreshCw />
              重启核心
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            刷新状态
          </Button>
        </span>
      </div>
    </section>
  );
}
