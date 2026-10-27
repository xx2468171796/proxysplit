// 节点列表工具（参照 v2rayN）：排序方式、一键删除检测不通的节点。
import { Button, ConfirmDialog, SegmentedControl } from "@ankotti/admin-ui";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { Node } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { removeNodes } from "../../state/nodes";

export type NodeSort = "default" | "latency" | "name";

const SORT_OPTIONS: { value: NodeSort; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "latency", label: "按延迟" },
  { value: "name", label: "按名称" },
];

/** 检测过且 Google 不通的节点（-99 = 检测中，0 / undefined = 未检测）。 */
export const isDead = (n: Node) => n.latency !== undefined && n.latency < 0 && n.latency !== -99;

/** 延迟排序：通的按毫秒升序，未检测其次，不通的垫底。 */
function latencyRank(n: Node): number {
  const ms = n.latency ?? 0;
  if (ms > 0) return ms;
  if (ms === 0 || ms === -99) return 1e7;
  return 1e8;
}

export function sortNodes(nodes: Node[], by: NodeSort): Node[] {
  if (by === "default") return nodes;
  const out = [...nodes];
  if (by === "latency") out.sort((a, b) => latencyRank(a) - latencyRank(b));
  else out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  return out;
}

export function NodeSortControl({ value, onChange }: { value: NodeSort; onChange: (v: NodeSort) => void }) {
  return <SegmentedControl size="sm" label="排序" options={SORT_OPTIONS} value={value} onValueChange={onChange} />;
}

/** 删除全部「Google 不通」的节点；订阅里的节点下次更新订阅会回来。 */
export function RemoveDeadButton({ nodes }: { nodes: Node[] }) {
  const { say } = useFeedback();
  const [open, setOpen] = useState(false);
  const dead = nodes.filter(isDead);
  const confirm = async () => {
    const err = await removeNodes(dead.map((n) => n.id));
    say(err ? `已删除 ${dead.length} 个不通的节点（${err}）` : `已删除 ${dead.length} 个不通的节点`);
  };
  return (
    <>
      <Button variant="outline" size="sm" disabled={!dead.length} onClick={() => setOpen(true)}>
        <Trash2 />
        删除不通的（{dead.length}）
      </Button>
      <ConfirmDialog
        open={open}
        title={`删除 ${dead.length} 个检测不通的节点？`}
        description="只删「Google 不通」的节点；来自订阅的节点下次更新订阅会重新出现。"
        destructive
        confirmLabel="删除"
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
