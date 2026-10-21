// 新建 / 编辑自定义线路：名称 + 出口 + 分流模式（自定义时再配一组路由规则）。
import { Choice, FormDialog, FormField, Input, type SelectItem } from "@ankotti/admin-ui";
import { Collapse } from "@ankotti/admin-ui/motion";
import { useMemo, useState } from "react";
import type { Line } from "../../api/types";
import { latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { type LineDraft, saveLine } from "../../state/routing";
import { RouteRuleEditor } from "./route-rule-editor";

const MODES: SelectItem[] = [
  { value: "global", label: "全局", hint: "全部走出口" },
  { value: "bypass_cn", label: "绕过大陆", hint: "大陆直连，其余走出口" },
  { value: "custom", label: "自定义", hint: "按下面的规则" },
];

function toDraft(line: Line | null): LineDraft {
  if (!line) return { id: "", name: "", node: "active", mode: "global", rules: [] };
  return {
    id: line.id,
    name: line.name,
    node: line.node,
    mode: line.routing.mode,
    rules: (line.routing.rules ?? []).map((r) => ({ ...r })),
  };
}

export function LineDialog({ line, onClose }: { line: Line | null; onClose: () => void }) {
  const nodes = useStore(data, (s) => s.nodes);
  const [initial] = useState(() => toDraft(line));
  const [draft, setDraft] = useState(initial);
  const set = (p: Partial<LineDraft>) => setDraft((d) => ({ ...d, ...p }));
  const exits = useMemo<SelectItem[]>(
    () => [
      { value: "active", label: "跟随活动节点" },
      ...nodes.map((n) => ({ value: n.id, label: n.name, hint: latencyText(n.latency) })),
      { value: "direct", label: "直连" },
    ],
    [nodes],
  );

  return (
    <FormDialog
      open
      size="lg"
      title={line ? "编辑线路" : "新建线路"}
      description="每条线路 = 一个出口 + 一套分流策略；在「应用分流」里给应用选线路。"
      submitLabel="保存线路"
      dirty={JSON.stringify(initial) !== JSON.stringify(draft)}
      onClose={onClose}
      onSubmit={async () => {
        const err = await saveLine(draft);
        if (err) throw new Error(err);
      }}
    >
      <FormField label="名称" htmlFor="line-name" required>
        <Input
          id="line-name"
          value={draft.name}
          placeholder="如 美区-全局"
          onChange={(e) => set({ name: e.target.value })}
        />
      </FormField>
      <FormField label="出口" htmlFor="line-node">
        <Choice id="line-node" label="出口" value={draft.node} options={exits} onChange={(node) => set({ node })} />
      </FormField>
      <FormField label="分流模式" htmlFor="line-mode" full>
        <Choice id="line-mode" label="分流模式" value={draft.mode} options={MODES} onChange={(mode) => set({ mode })} />
      </FormField>
      <div className="ps-full">
        <Collapse open={draft.mode === "custom"}>
          <RouteRuleEditor
            variant="short"
            idBase="line-rule"
            rules={draft.rules}
            onChange={(rules) => set({ rules })}
            defaultAction="direct"
            addLabel="添加规则"
            emptyText="还没有自定义规则。点「添加规则」新增一条。"
          />
        </Collapse>
      </div>
    </FormDialog>
  );
}
