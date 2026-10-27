// 节点表的列与行内操作：延迟按分档着色，同一种测试同时只跑一个（其它行的同类按钮置灰并说明原因）。
import {
  CellText,
  type Column,
  type RowAction,
  RowActionBar,
  StatusBadge,
  Tag,
  useMediaQuery,
} from "@ankotti/admin-ui";
import { CirclePlay, Cpu, Gauge, Globe, Network, Share2, Trash2 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import type { Node } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { latencyGrade, latencyText, tcpLatencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { selectNode } from "../../state/data";
import { type NodeTestState, nodeTests, testGoogle, testSpeed, testTCP } from "../../state/nodes";
import { runtime } from "../../state/runtime";
import { coreLabel } from "./node-core-dialog";

const GRADE_TONE = ["danger", "warning", "warning", "success", "success"] as const;

function latencyTone(ms?: number) {
  if (ms === -99) return "info";
  if (ms === undefined || ms === 0) return "neutral";
  return GRADE_TONE[latencyGrade(ms)];
}

/** 测出结果时底色闪一下（key 随结果变，重新挂载触发动画）。 */
function LatencyBadge({ ms, text }: { ms?: number; text: string }) {
  const result = ms !== undefined && ms !== 0 && ms !== -99;
  return (
    <span key={ms ?? 0} className="ps-latency" data-aui-flash={result ? (ms > 0 ? "good" : "bad") : undefined}>
      <StatusBadge variant="dot" tone={latencyTone(ms)}>
        {text}
      </StatusBadge>
    </span>
  );
}

export type NodeRowHandlers = { share: (n: Node) => void; remove: (n: Node) => void; core: (n: Node) => void };

type TestKind = "tcpId" | "googleId" | "speedId";

/** 一个测试按钮：本行在测显示「检测中…」，别的行在测就置灰。 */
function testAction(
  n: Node,
  tests: NodeTestState,
  kind: TestKind,
  base: { key: string; label: string; icon: ReactNode; busy: string },
  run: () => void,
): RowAction {
  const running = tests[kind];
  const mine = running === n.id;
  return {
    key: base.key,
    label: mine ? "检测中…" : base.label,
    icon: base.icon,
    disabled: Boolean(running) && !mine,
    disabledReason: base.busy,
    onSelect: mine ? () => undefined : run,
  };
}

function nodeActions(
  n: Node,
  ctx: { tests: NodeTestState; active: boolean; say: (t: string) => void; on: NodeRowHandlers },
): RowAction[] {
  const { tests, say, on } = ctx;
  const actions: RowAction[] = [
    testAction(
      n,
      tests,
      "tcpId",
      { key: "tcp", label: "测TCP", icon: <Network />, busy: "另一个节点正在测 TCP，稍等" },
      () => void testTCP(n.id).then(say),
    ),
    testAction(
      n,
      tests,
      "googleId",
      { key: "google", label: "测Google", icon: <Globe />, busy: "另一个节点正在测 Google，稍等" },
      () => void testGoogle(n.id).then(say),
    ),
    testAction(
      n,
      tests,
      "speedId",
      { key: "speed", label: "测速度", icon: <Gauge />, busy: "另一个节点正在测速，稍等" },
      () => void testSpeed(n.id).then(say),
    ),
  ];
  if (!ctx.active) {
    actions.push({
      key: "use",
      label: "设为活动",
      icon: <CirclePlay />,
      onSelect: () => void selectNode(n.id).then((err) => say(err || `已切换到「${n.name}」`)),
    });
  }
  actions.push({ key: "core", label: "内核", icon: <Cpu />, onSelect: () => on.core(n) });
  // POWER云 官方线路是会员专属，不给分享入口（后端也会拒绝）。
  if (!n.official) {
    actions.push({ key: "share", label: "分享节点", icon: <Share2 />, onSelect: () => on.share(n) });
  }
  actions.push({ key: "delete", label: "删除", icon: <Trash2 />, destructive: true, onSelect: () => on.remove(n) });
  return actions;
}

export function useNodeColumns(on: NodeRowHandlers): Column<Node>[] {
  const { say } = useFeedback();
  const tests = useStore(nodeTests, (s) => s);
  const selected = useStore(runtime, (s) => s.status?.selectedId);
  // 窄窗口只露两个按钮，免得操作列压住「状态」列。
  const wide = useMediaQuery("(min-width: 1300px)");
  return useMemo(
    () => [
      {
        key: "node",
        title: "节点",
        minWidth: 200,
        render: (n) => (
          <span className="ps-node-cell">
            <Tag size="sm">{n.type.toUpperCase()}</Tag>
            <Tag size="sm" variant="plain" title={n.core ? "手动指定的内核" : "自动选择的内核"}>
              {coreLabel(n)}
            </Tag>
            <CellText primary={n.name} secondary={`${n.server}:${n.port}`} />
          </span>
        ),
      },
      {
        key: "tcp",
        title: "TCP 延迟",
        width: 100,
        render: (n) => <LatencyBadge ms={n.tcpLatency} text={tcpLatencyText(n.tcpLatency)} />,
      },
      {
        key: "google",
        title: "Google 延迟",
        width: 116,
        render: (n) => <LatencyBadge ms={n.latency} text={latencyText(n.latency)} />,
      },
      {
        key: "speed",
        title: "速度 MB/s",
        width: 92,
        numeric: true,
        render: (n) => (n.speed ? n.speed.toFixed(2) : "—"),
      },
      {
        key: "status",
        title: "状态",
        width: 72,
        mobile: "status",
        render: (n) =>
          n.id === selected ? (
            <StatusBadge variant="dot" tone="success">
              活动
            </StatusBadge>
          ) : null,
      },
      {
        key: "actions",
        title: "操作",
        kind: "actions",
        width: 256,
        render: (n) => (
          <RowActionBar
            max={wide ? 3 : 2}
            label={`${n.name}的更多操作`}
            actions={nodeActions(n, { tests, active: n.id === selected, say, on })}
          />
        ),
      },
    ],
    [tests, selected, say, on, wide],
  );
}
