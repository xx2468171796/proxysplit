// 清除与重置的一行：标题 + 作用 + 预览数量 + 标记（会重启内核 / 可撤销 / 危险）+ 执行按钮。
import { Button, FormField, StatusBadge } from "@ankotti/admin-ui";
import { Eraser, RotateCcw } from "lucide-react";
import type { ResetItem } from "../../../api/reset";

type Props = { item: ResetItem; busy: boolean; disabled: boolean; onRun: (item: ResetItem) => void };

function hintOf(item: ResetItem): string {
  const parts = [item.effect];
  if (item.countText && item.count >= 0) parts.push(item.countText);
  if (!item.available) parts.push("该功能上线后自动可用");
  return parts.join(" · ");
}

export function ResetRow({ item, busy, disabled, onRun }: Props) {
  const isConfig = item.group === "config";
  return (
    <FormField label={item.title} htmlFor={`reset-${item.id}`} hint={hintOf(item)}>
      <div className="ps-set-actions ps-reset-actions">
        {item.restarts ? <StatusBadge tone="info">会重启内核</StatusBadge> : null}
        {item.backup ? <StatusBadge tone="success">可撤销</StatusBadge> : null}
        {item.danger === "danger" ? <StatusBadge tone="danger">危险</StatusBadge> : null}
        <Button
          id={`reset-${item.id}`}
          size="sm"
          variant={item.danger === "danger" ? "destructive-outline" : "outline"}
          loading={busy}
          disabledReason={!item.available ? "暂未接入" : disabled ? "正在执行其它项" : undefined}
          onClick={() => onRun(item)}
        >
          {isConfig ? <RotateCcw /> : <Eraser />}
          {isConfig ? "重置" : item.group === "network" ? "修复" : "清除"}
        </Button>
      </div>
    </FormField>
  );
}
