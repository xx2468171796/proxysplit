// 概览「当前链路」：走什么模式、哪个节点（协议 / 内核）、出口 IP、连 Google 的延迟、实时 Ping、连接数，一眼看清整条链路。
import { DescriptionList, Panel, StatusBadge } from "@ankotti/admin-ui";
import type { ClashMode } from "../../api/types";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { linkState } from "../../state/link";

const CLASH_TEXT: Record<ClashMode, string> = { rule: "按规则分流", global: "全部代理", direct: "全部直连" };

function msBadge(ms: number, wait: string) {
  if (ms === 0) return <StatusBadge tone="neutral">{wait}</StatusBadge>;
  if (ms < 0) return <StatusBadge tone="danger">不通</StatusBadge>;
  const tone = ms < 200 ? "success" : ms < 500 ? "warning" : "danger";
  return <StatusBadge tone={tone}>{ms} ms</StatusBadge>;
}

export function LinkPanel() {
  const link = useStore(linkState, (s) => s.link);
  const exit = useStore(linkState, (s) => s.exit);
  const clash = useStore(data, (s) => s.clashMode);
  const tun = useStore(data, (s) => s.settings.captureMode === "tun");
  const where = [exit?.country, exit?.city].filter(Boolean).join(" · ");
  const off = !link.running;
  return (
    <Panel className="qd-pane" title="当前链路" description={off ? "代理没在运行" : "每秒刷新"}>
      <DescriptionList
        layout="stacked"
        columns={3}
        items={[
          { label: "模式", value: `${CLASH_TEXT[clash]} · ${tun ? "整机 TUN" : "仅接管选中程序"}` },
          {
            label: "节点",
            value: link.nodeName ? `${link.nodeName}（${link.nodeType.toUpperCase() || "未知协议"}）` : "未选择",
          },
          {
            label: "出口 IP",
            value: off ? "—" : exit?.ip ? `${exit.ip}${where ? ` · ${where}` : ""}` : "查询中…",
          },
          { label: "连 Google", value: off ? "—" : msBadge(link.googleMs, "测量中") },
          {
            label: "实时 Ping",
            value: off ? (
              "—"
            ) : (
              <span className="ps-row">
                {msBadge(link.pingMs, "等待中")}
                {link.pingP50 > 0 ? <small>中位 {link.pingP50} ms</small> : null}
              </span>
            ),
          },
          { label: "连接数", value: off ? "—" : `${link.conns} 个` },
        ]}
      />
    </Panel>
  );
}
