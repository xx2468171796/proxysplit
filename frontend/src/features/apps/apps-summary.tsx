// 应用分流概况：分流模式切换、规则数、未列出的应用走哪；「默认全代理」时可选未列出的应用走哪条线路。
import { Choice, Note, SegmentedControl, type SelectItem, StatStrip } from "@ankotti/admin-ui";
import { CircleCheck, LayoutGrid, Route, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import type { RuleMode } from "../../api/types";
import { useStore } from "../../shared/store";
import { data, setDefaultLine, setRuleMode } from "../../state/data";
import { nodeName } from "../../state/nodes";
import { BUILTIN_LINES, builtinLineOptions, modeLabel } from "../../state/routing";
import { runtime } from "../../state/runtime";
import { useSaveNotice } from "./use-save-notice";

const MODES: { value: RuleMode; label: string }[] = [
  { value: "whitelist", label: "只代理列出的" },
  { value: "blacklist", label: "默认全代理" },
];

const DEFAULT_LINES: SelectItem[] = builtinLineOptions(["rule", "global", "direct"]);

/** 未列出的应用：值 + 补充说明。 */
function useUnlisted(): { value: string; note: string } {
  const ruleMode = useStore(data, (s) => s.ruleMode);
  const defaultLine = useStore(data, (s) => s.defaultLine);
  const lines = useStore(data, (s) => s.lines);
  const nodes = useStore(data, (s) => s.nodes);
  const selectedId = useStore(runtime, (s) => s.status?.selectedId);
  if (ruleMode === "whitelist" || defaultLine === "direct")
    return { value: BUILTIN_LINES.direct.label, note: "直接连接" };
  const active = (selectedId && nodeName(selectedId, nodes)) || "活动节点";
  if (defaultLine === "rule") return { value: BUILTIN_LINES.rule.label, note: active };
  if (defaultLine === "global") return { value: BUILTIN_LINES.global.label, note: active };
  const line = lines.find((l) => l.id === defaultLine);
  return {
    value: line?.name || BUILTIN_LINES.rule.label,
    note: line ? `自定义线路 · ${modeLabel(line.routing.mode)}` : active,
  };
}

function SummaryControls() {
  const save = useSaveNotice();
  const ruleMode = useStore(data, (s) => s.ruleMode);
  const defaultLine = useStore(data, (s) => s.defaultLine);
  const lines = useStore(data, (s) => s.lines);
  const options = useMemo<SelectItem[]>(
    () => [
      ...DEFAULT_LINES,
      ...lines.filter((l) => !l.builtin).map((l) => ({ value: l.id, label: l.name, group: "自定义线路" })),
    ],
    [lines],
  );
  return (
    <span className="ps-row ps-wrap">
      {ruleMode === "blacklist" ? (
        <>
          <Note as="span">未列出的走</Note>
          <Choice
            size="sm"
            width={200}
            label="未列出的应用走哪条线路"
            value={defaultLine}
            options={options}
            onChange={(id) => save(setDefaultLine(id))}
          />
        </>
      ) : null}
      <SegmentedControl
        size="sm"
        label="分流模式"
        value={ruleMode}
        options={MODES}
        onValueChange={(m) => save(setRuleMode(m))}
      />
    </span>
  );
}

export function AppsSummary() {
  const rules = useStore(data, (s) => s.rules);
  const ruleMode = useStore(data, (s) => s.ruleMode);
  const unlisted = useUnlisted();
  const items = useMemo(() => {
    const enabled = rules.filter((r) => r.enabled).length;
    const proxied = rules.filter((r) => r.enabled && r.line !== "direct" && r.line !== "block").length;
    return [
      {
        key: "mode",
        label: "分流模式",
        icon: <SlidersHorizontal />,
        value: ruleMode === "whitelist" ? "只代理列出的" : "默认全代理",
        note: ruleMode === "whitelist" ? "日常推荐" : "没列出的也走代理",
      },
      {
        key: "rules",
        label: "应用规则",
        icon: <LayoutGrid />,
        value: rules.length,
        unit: "条",
        note: `${proxied} 条走代理`,
      },
      {
        key: "enabled",
        label: "已启用",
        icon: <CircleCheck />,
        value: enabled,
        unit: "条",
        note: `${rules.length - enabled} 条停用`,
      },
      { key: "unlisted", label: "未列出的应用", icon: <Route />, value: unlisted.value, note: unlisted.note },
    ];
  }, [rules, ruleMode, unlisted.value, unlisted.note]);
  return <StatStrip title="分流概况" items={items} actions={<SummaryControls />} />;
}
