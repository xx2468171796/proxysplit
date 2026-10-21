// 应用规则表的可编辑单元格：分流方式、节点、启用、测试。每格自己订阅需要的数据。
import { Button, CellText, Choice, Note, type SelectItem, Switch, Tag, Tooltip } from "@ankotti/admin-ui";
import { useEffect, useMemo, useRef } from "react";
import type { AppRule } from "../../api/types";
import { RuleIcon } from "../../components/app-icon";
import { appLatencyText, latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { apps, hasScope, isRuleRunning, ruleName, testApp, updateRule } from "../../state/app-rules";
import { data } from "../../state/data";
import { lineNodeLabel } from "../../state/nodes";
import { customLineOf, modeLabel } from "../../state/routing";
import { runtime } from "../../state/runtime";
import { useSaveNotice } from "./use-save-notice";

const BUILTIN: SelectItem[] = [
  { value: "rule", label: "规则", hint: "大陆直连、境外走节点" },
  { value: "global", label: "全局", hint: "全部走节点" },
  { value: "direct", label: "直连", hint: "不走代理" },
  { value: "block", label: "拦截", hint: "断网" },
];

export function AppCell({ rule }: { rule: AppRule }) {
  const running = useStore(apps, (s) => s.running);
  const on = isRuleRunning(rule, running);
  return (
    <span className="ps-app-cell ps-rule-app">
      <RuleIcon rule={rule} />
      <CellText
        primary={
          <span className="ps-row">
            <span className="ps-ellipsis">{ruleName(rule)}</span>
            <Tooltip content={on ? "正在运行" : "未运行"}>
              <span className="ps-run-dot" data-on={on || undefined} />
            </Tooltip>
            {hasScope(rule) ? (
              <Tag size="sm" title="仅对指定目标生效">
                限定
              </Tag>
            ) : null}
          </span>
        }
        primaryTitle={ruleName(rule)}
        secondary={rule.path}
        secondaryTitle={rule.path}
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
      tooltip="测试此应用的连通与延迟"
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
