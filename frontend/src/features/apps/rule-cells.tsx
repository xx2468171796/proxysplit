// 应用规则表的可编辑单元格：分流方式、节点、启用、测试。每格自己订阅需要的数据。
import { Button, CellText, Choice, Note, type SelectItem, Switch, Tag, Tooltip } from "@ankotti/admin-ui";
import { FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { AppRule } from "../../api/types";
import { RuleIcon } from "../../components/app-icon";
import { appLatencyText, latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { apps, isDirRule, isRuleRunning, ruleDisplayName, ruleName, testApp, updateRule } from "../../state/app-rules";
import { data } from "../../state/data";
import { lineNodeLabel } from "../../state/nodes";
import { builtinLineOptions, customLineOf, modeLabel } from "../../state/routing";
import { runtime } from "../../state/runtime";
import { useSaveNotice } from "./use-save-notice";

const BUILTIN: SelectItem[] = builtinLineOptions(["rule", "global", "direct", "block"]);

export function AppCell({ rule }: { rule: AppRule }) {
  const running = useStore(apps, (s) => s.running);
  const procs = useStore(apps, (s) => s.procs);
  const on = isRuleRunning(rule, running);
  const dir = isDirRule(rule);
  const name = ruleDisplayName(rule, procs);
  const file = dir ? "整个目录" : ruleName(rule);
  return (
    <span className="ps-app-cell ps-rule-app">
      {dir ? <FolderOpen className="ps-app-icon" aria-hidden="true" /> : <RuleIcon rule={rule} />}
      <CellText
        primary={
          <span className="ps-row">
            <span className="ps-ellipsis">{name}</span>
            {on ? (
              <Tag size="sm" variant="soft" title="这个程序正在运行">
                运行中
              </Tag>
            ) : null}
          </span>
        }
        primaryTitle={name}
        secondary={name === file ? rule.path : `${file} · ${rule.path || rule.match}`}
        secondaryTitle={rule.path || rule.match}
      />
    </span>
  );
}

export function LineCell({ rule }: { rule: AppRule }) {
  const save = useSaveNotice();
  const lines = useStore(data, (s) => s.lines);
  const options = useMemo<SelectItem[]>(
    () => [
      ...BUILTIN,
      ...lines
        .filter((l) => !l.builtin)
        .map((l) => ({ value: l.id, label: l.name, hint: modeLabel(l.routing.mode), group: "自定义线路" })),
    ],
    [lines],
  );
  return (
    <Choice
      size="sm"
      label={`${ruleName(rule)}的分流方式`}
      value={rule.line}
      options={options}
      onChange={(line) => save(updateRule(rule.match, { line }))}
    />
  );
}

export function NodeCell({ rule }: { rule: AppRule }) {
  const save = useSaveNotice();
  const nodes = useStore(data, (s) => s.nodes);
  const lines = useStore(data, (s) => s.lines);
  const selectedId = useStore(runtime, (s) => s.status?.selectedId);
  const options = useMemo<SelectItem[]>(() => {
    const active = nodes.find((n) => n.id === selectedId);
    return [
      { value: "", label: "活动节点", hint: active ? latencyText(active.latency) : undefined },
      ...nodes.map((n) => ({ value: n.id, label: n.name, hint: latencyText(n.latency) })),
    ];
  }, [nodes, selectedId]);
  const custom = customLineOf(rule.line, lines);
  if (custom) {
    return (
      <Tooltip content="自定义线路自带出口，到「分流规则 → 线路」修改">
        <Note as="span" className="ps-ellipsis">
          {lineNodeLabel(custom.node || "active", nodes)}（线路自带）
        </Note>
      </Tooltip>
    );
  }
  return (
    <Choice
      size="sm"
      label={`${ruleName(rule)}走哪个节点`}
      value={rule.node || ""}
      options={options}
      disabled={rule.line === "direct" || rule.line === "block"}
      onChange={(node) => save(updateRule(rule.match, { node }))}
    />
  );
}

export function EnabledCell({ rule }: { rule: AppRule }) {
  const save = useSaveNotice();
  return (
    <Switch
      size="sm"
      aria-label={`启用${ruleName(rule)}`}
      checked={rule.enabled}
      onCheckedChange={(enabled) => save(updateRule(rule.match, { enabled }))}
    />
  );
}

function latTone(ms: number | undefined): string | undefined {
  if (ms === undefined || ms === -99) return undefined;
  if (ms === -2 || ms < 0) return "err";
  return "ok";
}

export function TestCell({ rule }: { rule: AppRule }) {
  const ms = useStore(apps, (s) => s.latency[rule.match]);
  // 只在这次测完时闪一下（-99 → 结果），重新进页面不闪。
  const prev = useRef(ms);
  const justDone = prev.current === -99 && ms !== -99;
  useEffect(() => {
    prev.current = ms;
  }, [ms]);
  const tone = latTone(ms);
  return (
    <Button
      size="xs"
      variant="ghost"
      tooltip="点一下，测这个应用能不能连上、速度多快"
      loading={ms === -99}
      onClick={() => void testApp(rule.match)}
    >
      <span
        key={ms}
        className="ps-lat"
        data-tone={tone}
        data-aui-flash={justDone && tone ? (tone === "ok" ? "good" : "bad") : undefined}
      >
        {appLatencyText(ms)}
      </span>
    </Button>
  );
}
