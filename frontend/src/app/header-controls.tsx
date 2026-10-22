// 顶栏右侧：活动节点、代理策略、实时速率与连接、启动 / 停止（主题在设置页，只认 settings.theme）。
import { Button, Choice, SegmentedControl, Tooltip } from "@ankotti/admin-ui";
import { ArrowDown, ArrowUp, Power, Square } from "lucide-react";
import { useMemo } from "react";
import type { ClashMode } from "../api/types";
import { fmtRate, fmtUptime, latencyText } from "../shared/format";
import { useStore } from "../shared/store";
import { data, selectNode, setClashMode } from "../state/data";
import { isRunning, runtime, toggleRun } from "../state/runtime";
import { useFeedback } from "./use-feedback";

const CLASH_OPTIONS: { value: ClashMode; label: string }[] = [
  { value: "rule", label: "按规则" },
  { value: "global", label: "全部代理" },
  { value: "direct", label: "全部直连" },
];

function NodeSwitcher() {
  const { say } = useFeedback();
  const nodes = useStore(data, (s) => s.nodes);
  const selected = useStore(runtime, (s) => s.status?.selectedId ?? "");
  const options = useMemo(
    () =>
      nodes.map((n) => ({
        value: n.id,
        label: n.name,
        hint: latencyText(n.latency),
        keywords: `${n.server} ${n.type}`,
      })),
    [nodes],
  );
  return (
    <Choice
      label="活动节点"
      size="sm"
      width={240}
      placeholder={nodes.length ? "选择活动节点" : "还没有节点"}
      disabled={!nodes.length}
      options={options}
      value={selected}
      onChange={(id) => void selectNode(id).then(say)}
    />
  );
}

function Traffic() {
  const down = useStore(runtime, (s) => s.downRate);
  const up = useStore(runtime, (s) => s.upRate);
  const status = useStore(runtime, (s) => s.status);
  const running = isRunning(status);
  const d = fmtRate(down);
  const u = fmtRate(up);
  const conns = status?.stats?.activeConns ?? 0;
  const tip = running ? `${conns} 个活动连接 · 已运行 ${fmtUptime(status?.uptimeSec ?? 0)}` : "代理未运行";
  return (
    <Tooltip content={tip}>
      <span className="ps-traffic" data-running={running}>
        <span>
          <ArrowDown aria-hidden="true" />
          {d.value} {d.unit}
        </span>
        <span>
          <ArrowUp aria-hidden="true" />
          {u.value} {u.unit}
        </span>
      </span>
    </Tooltip>
  );
}

function PowerButton() {
  const { say } = useFeedback();
  const running = useStore(runtime, (s) => isRunning(s.status));
  const busy = useStore(runtime, (s) => s.busy);
  return (
    <Button
      size="sm"
      variant={running ? "outline" : "default"}
      loading={busy}
      onClick={() => void toggleRun().then(say)}
    >
      {running ? <Square /> : <Power />}
      {running ? "停止" : "启动"}
    </Button>
  );
}

export function HeaderControls() {
  const { say } = useFeedback();
  const clash = useStore(data, (s) => s.clashMode);
  return (
    <span className="ps-header">
      <NodeSwitcher />
      <SegmentedControl
        size="sm"
        label="代理策略：规则 = 智能分流，全局 = 全走代理，直连 = 全不走（不重启）"
        options={CLASH_OPTIONS}
        value={clash}
        onValueChange={(m) => void setClashMode(m).then((err) => say(err && `切换失败：${err}`))}
      />
      <Traffic />
      <PowerButton />
    </span>
  );
}
