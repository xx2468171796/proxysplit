// 会员闸门底部「公告与更新」：最新 4 条。
import { ActionList, Panel } from "@ankotti/admin-ui";
import { Megaphone } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";

export function GateAnnouncements() {
  const all = useStore(license, (s) => s.announcements);
  const items = useMemo(
    () =>
      all.slice(0, 4).map((a) => ({
        key: a.id,
        icon: <Megaphone />,
        title: a.title,
        detail: a.summary || a.content,
        meta: new Date(a.publishedAt).toLocaleDateString(),
      })),
    [all],
  );
  if (!items.length) return null;
  return (
    <div className="ps-gate-block">
      <Panel title="公告与更新" count={`${all.length} 条`}>
        <ActionList label="公告与更新" items={items} />
      </Panel>
    </div>
  );
}
