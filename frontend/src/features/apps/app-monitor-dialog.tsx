// 应用连接监测（三层：应用 → 网站 → 单条连接）：概况与结论 → 立即检测 → 状态筛选 + 搜索 + 视图切换 → 按网站 / 全部连接 / 相关日志。
// 打开期间每 2 秒刷新，可暂停；点一个网站直接看它的每条连接。
import { Button, Dialog, SearchBox, TableToolbar, ToggleGroup } from "@ankotti/admin-ui";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { resetAppStat } from "../../state/app-monitor";
import { CoreLogs } from "../ports/detail-tables";
import { AppAccessTable } from "./app-access-table";
import { HealthBadge } from "./monitor-badge";
import { MonitorHostsTable } from "./monitor-hosts-table";
import { MonitorSummary } from "./monitor-summary";
import { countAccess, matchAccess, matchHost, type StatusFilter } from "./monitor-view";
import { ProbePanel } from "./probe-panel";
import { useAppDetail } from "./use-app-detail";

type View = "hosts" | "conns" | "logs";

const VIEWS = [
  { value: "hosts", label: "按网站" },
  { value: "conns", label: "全部连接" },
  { value: "logs", label: "相关日志" },
] as const;

/** 规则里的目录显示成「ldplayer9box（整个目录）」 */
export function monitorTitle(name: string): string {
  if (!/[\\/]$/.test(name)) return name;
  const parts = name.split(/[\\/]/).filter(Boolean);
  return `${parts[parts.length - 1] ?? name}（整个目录）`;
}

export function AppMonitorDialog({ process, onClose }: { process: string; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const detail = useAppDetail(process, paused);
  const [view, setView] = useState<View>("hosts");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [host, setHost] = useState("");

  const access = detail?.access ?? [];
  const counts = useMemo(() => countAccess(access), [access]);
  const hosts = useMemo(
    () => (detail?.hosts ?? []).filter((h) => matchHost(h, filter, query)),
    [detail, filter, query],
  );
  const conns = useMemo(() => access.filter((a) => matchAccess(a, filter, query, host)), [access, filter, query, host]);

  const resetKey = `${filter}|${query}|${host}`;
  const views = [
    { value: "all", label: "全部", count: counts.all },
    { value: "failed", label: "失败", count: counts.failed, tone: counts.failed ? ("danger" as const) : undefined },
    { value: "ok", label: "正常", count: counts.ok },
    { value: "live", label: "进行中", count: counts.live },
    { value: "blocked", label: "拦截", count: counts.blocked },
  ];
  const openHost = (h: string) => {
    setHost(h);
    setView("conns");
  };

  return (
    <Dialog
      open
      size="xl"
      title={`${monitorTitle(process)} · 连接监测`}
      description={/[\\/]$/.test(process) ? `统计 ${process} 下所有程序的连接` : undefined}
      titleAdornment={<HealthBadge stat={detail?.stat} />}
      headerActions={
        <>
          <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play /> : <Pause />}
            {paused ? "继续刷新" : "暂停刷新"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void resetAppStat(process);
              setPaused(false); // 暂停时也要马上看到已经清空
            }}
          >
            <RotateCcw />
            清空统计
          </Button>
        </>
      }
      onClose={onClose}
    >
      <div className="ps-port-detail">
        <MonitorSummary stat={detail?.stat} access={access} processes={detail?.processes ?? []} />
        <ProbePanel process={process} />
        <TableToolbar
          label="连接筛选"
          views={{ views, value: filter, onChange: (v) => setFilter(v as StatusFilter), label: "按结果筛选" }}
          search={
            <SearchBox value={query} onChange={setQuery} placeholder="搜网站、程序、出口或错误…" label="搜索连接" />
          }
          tools={
            <ToggleGroup
              type="single"
              label="视图"
              size="sm"
              variant="outline"
              items={VIEWS}
              value={view}
              onValueChange={(v) => {
                if (!v) return;
                setView(v as View);
                if (v !== "conns") setHost(""); // 「只看某网站」只在全部连接里有意义
              }}
            />
          }
        />
        {host && view === "conns" ? (
          <div className="ps-mon-line">
            <span className="ps-mon-label">只看</span>
            <b>{host}</b>
            <Button size="xs" variant="ghost" onClick={() => setHost("")}>
              <X />
              看全部
            </Button>
          </div>
        ) : null}
        {view === "hosts" && <MonitorHostsTable hosts={hosts} onOpen={openHost} resetKey={resetKey} />}
        {view === "conns" && <AppAccessTable access={conns} resetKey={resetKey} />}
        {view === "logs" && <CoreLogs logs={detail?.logs ?? []} />}
      </div>
    </Dialog>
  );
}
