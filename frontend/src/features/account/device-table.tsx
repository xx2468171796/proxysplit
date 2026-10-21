// 已绑定设备表：名称、平台 · 版本 · 最近在线、本机标记、解绑（先确认；本机不能解绑）。
// 设置页「设备管理」和会员闸门「选择要解绑的旧设备」共用。
import { CellText, type Column, ConfirmDialog, DataTable, RowActionBar, Tag } from "@ankotti/admin-ui";
import { Unlink } from "lucide-react";
import { useState } from "react";
import type { AccountDevice } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { fmtDateTime } from "../../shared/format";
import { useStore } from "../../shared/store";
import { license, unbindDevice } from "../../state/account";

type Props = { caption: string; emptyLabel: string };

function columns(onUnbind: (d: AccountDevice) => void): Column<AccountDevice>[] {
  return [
    {
      key: "name",
      title: "设备",
      mobile: "primary",
      render: (d) => (
        <CellText
          primary={d.name}
          secondary={`${d.platform || "Windows"} · v${d.appVersion || "未知"} · 最近在线 ${fmtDateTime(d.lastSeenAt)}`}
        />
      ),
    },
    {
      key: "current",
      title: "本机",
      width: 80,
      mobile: "status",
      render: (d) => (d.current ? <Tag size="sm">本机</Tag> : null),
    },
    {
      key: "actions",
      title: "操作",
      kind: "actions",
      width: 96,
      render: (d) => (
        <RowActionBar
          label={`${d.name}的更多操作`}
          actions={[
            {
              key: "unbind",
              label: "解绑",
              icon: <Unlink />,
              destructive: true,
              menuOnly: false,
              disabled: d.current,
              disabledReason: "当前正在使用的本机不能解绑",
              onSelect: () => onUnbind(d),
            },
          ]}
        />
      ),
    },
  ];
}

export function DeviceTable({ caption, emptyLabel }: Props) {
  const { say } = useFeedback();
  const devices = useStore(license, (s) => s.devices);
  const loading = useStore(license, (s) => s.loading);
  const [target, setTarget] = useState<AccountDevice | null>(null);

  return (
    <>
      <DataTable
        caption={caption}
        rows={devices}
        rowKey={(d) => d.id}
        columns={columns(setTarget)}
        pagination={{ mode: "all" }}
        rowHeight="medium"
        refreshing={loading && devices.length > 0}
        emptyLabel={emptyLabel}
      />
      <ConfirmDialog
        open={target !== null}
        title={`解绑设备「${target?.name ?? ""}」？`}
        description="确认解绑这台设备并立即撤销会话？该设备需要重新登录才能使用。"
        destructive
        confirmLabel="解绑"
        onConfirm={async () => {
          if (!target) return;
          const r = await unbindDevice(target.id);
          if (r.err) throw new Error(r.err);
          say(r.notice || "设备已解绑");
        }}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
