// 设置里的「去别处」一行：标签 + 说明 + 一到两个跳转按钮（功能只有一个正式位置，其它地方只放链接）。
import { Button, FormField } from "@ankotti/admin-ui";
import { ArrowUpRight } from "lucide-react";

type Action = { label: string; onClick: () => void };

export function LinkRow({ id, label, hint, actions }: { id: string; label: string; hint?: string; actions: Action[] }) {
  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      <div className="ps-set-actions">
        {actions.map((a, i) => (
          <Button key={a.label} id={i === 0 ? id : undefined} size="sm" variant="outline" onClick={a.onClick}>
            <ArrowUpRight />
            {a.label}
          </Button>
        ))}
      </div>
    </FormField>
  );
}
