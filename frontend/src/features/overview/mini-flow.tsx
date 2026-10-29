// 概览里的小连接图：最活跃的几个程序 → 直连 / 节点 → 网站，线条流动表示正在走流量。点「查看全部」进「连接」页。
import { Button, Panel } from "@ankotti/admin-ui";
import { useMemo } from "react";
import { navigate } from "../../app/nav";
import { useStore } from "../../shared/store";
import { isRunning, runtime } from "../../state/runtime";
import { buildFlowGraph } from "../flows/flow-model";
import { FlowSvgContent, layout } from "../flows/flow-svg";
import "../flows/flows.css";

export function MiniFlow() {
  const conns = useStore(runtime, (s) => s.conns);
  const running = useStore(runtime, (s) => isRunning(s.status));
  const graph = useMemo(() => buildFlowGraph(conns, { maxApps: 6, maxSites: 8 }), [conns]);
  const { width, height } = layout(graph);
  return (
    <Panel
      className="qd-pane"
      title="流量去向"
      description="本机程序 → 走哪条路 → 访问的网站"
      actions={
        <Button size="sm" variant="text" onClick={() => navigate("flows")}>
          查看全部连接 →
        </Button>
      }
    >
      {running && graph.totalConns ? (
        <div className="ps-mini-flow">
          <svg viewBox={`-4 0 ${width + 8} ${height}`} role="img" aria-label="流量去向图">
            <FlowSvgContent graph={graph} onSelect={() => navigate("flows")} />
          </svg>
        </div>
      ) : (
        <p className="ps-flow-hint">{running ? "暂时没有连接" : "启动代理后这里会画出流量去向"}</p>
      )}
    </Panel>
  );
}
