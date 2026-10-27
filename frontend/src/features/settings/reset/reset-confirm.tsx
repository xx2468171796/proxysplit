// 有代价的重置先确认：逐条列出会丢什么、会保留什么；恢复出厂要输入确认文字。
import { ConfirmDialog, Note } from "@ankotti/admin-ui";
import type { ResetItem } from "../../../api/reset";

type Props = {
  item: ResetItem | null;
  onConfirm: (item: ResetItem) => Promise<void>;
  onClose: () => void;
};

export function ResetConfirm({ item, onConfirm, onClose }: Props) {
  const lost = item?.lost.length ? item.lost : item ? [item.effect] : [];
  return (
    <ConfirmDialog
      open={item !== null}
      title={`${item?.title ?? ""}？`}
      destructive={item?.danger === "danger"}
      tone={item?.danger === "danger" ? "danger" : "warning"}
      confirmLabel={item?.group === "config" ? "重置" : "执行"}
      description={
        item?.backup ? "会丢失下面这些内容。执行前自动备份，可在本页点「撤销上次重置」找回。" : "会影响下面这些内容。"
      }
      impact={item?.countText && item.count > 0 ? [...lost, item.countText] : lost}
      typeToConfirm={item?.confirm || undefined}
      onConfirm={async () => {
        if (item) await onConfirm(item);
      }}
      onClose={onClose}
    >
      {item?.kept.length ? (
        <Note as="p" className="ps-set-note">
          会保留：{item.kept.join("、")}。
        </Note>
      ) : null}
    </ConfirmDialog>
  );
}
