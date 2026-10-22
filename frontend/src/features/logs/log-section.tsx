// 运行日志：核心 + 分流引擎 + 每条连接的原始日志（最近 800 行），按级别着色，新的在最下面。
// LogStream（motion）：在底部时自动跟随，往上翻时停住并提示「N 条新日志 ↓」。
import { Panel, SearchField, StatePanel } from "@ankotti/admin-ui";
import { type LogLine, LogStream } from "@ankotti/admin-ui/motion";
import { useMemo, useState } from "react";
import { type ParsedLog, parseLog } from "../../shared/format";
import { useStore } from "../../shared/store";
import { runtime } from "../../state/runtime";
import { useFillHeight } from "./use-fill-height";

type Line = LogLine & { search: string };

function levelOf(level: string): LogLine["level"] {
  if (level === "ERROR" || level === "FATAL" || level === "PANIC") return "error";
  return level === "WARN" ? "warn" : "info";
}

/** 等宽对齐成「时间  级别  [标签] 正文」几列。 */
function toLine(p: ParsedLog, id: number): Line {
  const text = `${p.time || "--:--:--"}  ${p.level.padEnd(5)}  ${p.tag ? `[${p.tag}] ` : ""}${p.msg}`;
  return { id, text, level: levelOf(p.level), search: text.toLowerCase() };
}

export function LogSection() {
  const logs = useStore(runtime, (s) => s.logs);
  const seq = useStore(runtime, (s) => s.logSeq);
  const [filter, setFilter] = useState("");
  const height = useFillHeight(176);
  const lines = useMemo(() => {
    const first = seq - logs.length;
    return logs.map((raw, i) => toLine(parseLog(raw), first + i));
  }, [logs, seq]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? lines.filter((l) => l.search.includes(q)) : lines;
  }, [lines, filter]);

  return (
    <Panel
      className="qd-pane"
      title="运行日志"
      count={filter ? `${shown.length} / ${lines.length} 行` : `${lines.length} 行`}
      description="核心 + 分流引擎 + 每条连接，保留最近 800 行；在底部时新日志自动跟上，往上翻时停住。"
      actions={
        <SearchField value={filter} onChange={setFilter} placeholder="过滤日志（关键字）" label="过滤日志" size="sm" />
      }
    >
      {shown.length ? (
        <LogStream lines={shown} height={height} label="运行日志" />
      ) : (
        <div className="ps-log-empty" style={{ height }}>
          <StatePanel
            kind={filter ? "no-results" : "empty"}
            title={filter ? "没有匹配的日志" : "暂无日志"}
            size="compact"
          />
        </div>
      )}
    </Panel>
  );
}
