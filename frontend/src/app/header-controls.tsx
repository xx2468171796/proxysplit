// 标题栏只放简单状态：活动节点、代理模式、TUN 开关、运行状态 + 实时 Ping（详情在概览）；右侧是启动 / 停止（主题在设置页，只认 settings.theme）。
import { Button, Choice, SegmentedControl, Switch, Tooltip } from "@ankotti/admin-ui";
import { Power, Square } from "lucide-react";
import { useMemo } from "react";
import type { ClashMode } from "../api/types";
import { fmtRate, fmtUptime, latencyText } from "../shared/format";
import { useStore } from "../shared/store";
import { data, saveSettings, selectNode, setClashMode } from "../state/data";
import { linkState } from "../state/link";
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
      width={200}
      placeholder={nodes.length ? "选择活动节点" : "还没有节点"}
      disabled={!nodes.length}
      options={options}
      value={selected}
      onChange={(id) => void selectNode(id).then(say)}
    />
  );
}

/** 运行状态点 + 实时 Ping（节点保活往返），悬停看速率和连接数 */
function LinkChip() {
  const status = useStore(runtime, (s) => s.status);
  const link = useStore(linkState, (s) => s.link);
  const down = fmtRate(useStore(runtime, (s) => s.downRate));
  const up = fmtRate(useStore(runtime, (s) => s.upRate));
  const running = isRunning(status);
  const ping = link.pingMs > 0 ? `${link.pingMs} ms` : link.pingMs < 0 ? "不通" : "—";
  const tip = running
    ? `已运行 ${fmtUptime(status?.uptimeSec ?? 0)} · ${link.conns} 个连接 · ↓${down.value}${down.unit} ↑${up.value}${up.unit}`
    : "代理未运行";
  return (
    <Tooltip content={tip}>
      <span className="ps-link-chip" data-running={running} data-bad={link.pingMs < 0 || undefined}>
        <i aria-hidden="true" />
        {running ? `运行中 · ${ping}` : "已停止"}
      </span>
    </Tooltip>
  );
}

export function PowerButton() {
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

export function TitleBarCenter() {
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
      <TunToggle />
      <LinkChip />
    </span>
  );
}

/** TUN 模式 = 接管方式「整机虚拟网卡」；关 = 仅接管选中程序（默认）。切换会重启内核。 */
function TunToggle() {
  const { say } = useFeedback();
  const tun = useStore(data, (s) => s.settings.captureMode === "tun");
  const busy = useStore(runtime, (s) => s.busy);
  return (
    <Tooltip content="TUN 模式：整机虚拟网卡接管全部程序再分流；关闭 = 只接管名单里的程序（推荐）">
      <span className="ps-tun-toggle">
        <Switch
          id="ps-tun-switch"
          checked={tun}
          disabled={busy}
          aria-label="TUN 模式"
          onCheckedChange={(on) =>
            void saveSettings({ captureMode: on ? "tun" : "process" }).then((e) => say(e, "error"))
          }
        />
        <label htmlFor="ps-tun-switch">TUN</label>
      </span>
    </Tooltip>
  );
}
