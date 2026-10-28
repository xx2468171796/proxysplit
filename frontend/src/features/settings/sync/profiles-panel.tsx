// 我的云端配置（会员）：另存为 / 恢复 / 用当前配置覆盖 / 改名 / 恢复密码 / 分享与取消分享 / 复制分享码 / 删除，带份数配额。
import {
  Button,
  CellText,
  type Column,
  DataTable,
  FormSection,
  InlineAlert,
  Note,
  RowActionBar,
  Tag,
} from "@ankotti/admin-ui";
import { CloudUpload, Copy, Download, KeyRound, Pencil, Share2, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConfigProfile } from "../../../api/types-account";
import { navigate } from "../../../app/nav";
import { useFeedback } from "../../../app/use-feedback";
import { fmtDateTime } from "../../../shared/format";
import { useStore } from "../../../shared/store";
import { license } from "../../../state/account";
import { configSync, loadProfiles } from "../../../state/configsync";
import { copyText } from "../../../state/system";
import { type ProfileDialog, ProfileDialogs } from "./profile-dialogs";
import { SharedCodeDialog } from "./share-dialog";

type Open = (d: ProfileDialog) => void;

function actionsOf(p: ConfigProfile, open: Open, copy: (code: string) => void) {
  return [
    {
      key: "restore",
      label: "恢复到本机",
      icon: <Download />,
      menuOnly: false,
      onSelect: () => open({ kind: "restore", p }),
    },
    { key: "overwrite", label: "用当前配置覆盖", icon: <Upload />, onSelect: () => open({ kind: "overwrite", p }) },
    { key: "rename", label: "改名", icon: <Pencil />, onSelect: () => open({ kind: "rename", p }) },
    {
      key: "password",
      label: p.locked ? "修改恢复密码" : "设置恢复密码",
      icon: <KeyRound />,
      onSelect: () => open({ kind: "password", p }),
    },
    p.shared
      ? { key: "unshare", label: "取消分享", icon: <X />, onSelect: () => open({ kind: "unshare", p }) }
      : { key: "share", label: "分享", icon: <Share2 />, onSelect: () => open({ kind: "share", p }) },
    ...(p.shared && p.shareCode
      ? [{ key: "copy", label: "复制分享码", icon: <Copy />, onSelect: () => copy(p.shareCode ?? "") }]
      : []),
    { key: "delete", label: "删除", icon: <Trash2 />, destructive: true, onSelect: () => open({ kind: "delete", p }) },
  ];
}

function columns(open: Open, copy: (code: string) => void): Column<ConfigProfile>[] {
  return [
    {
      key: "name",
      title: "配置",
      mobile: "primary",
      render: (p) => (
        <CellText
          primary={p.name}
          secondary={`${p.deviceName || "未知设备"} · ${fmtDateTime(p.updatedAt)} · ${Math.max(1, Math.round(p.size / 1024))} KB`}
        />
      ),
    },
    {
      key: "flags",
      title: "状态",
      width: 180,
      mobile: "status",
      render: (p) => (
        <span className="ps-set-actions">
          {p.locked ? <Tag size="sm">有恢复密码</Tag> : null}
          {p.shared ? <Tag size="sm">已分享 {p.shareCode ?? ""}</Tag> : null}
        </span>
      ),
    },
    {
      key: "actions",
      title: "操作",
      kind: "actions",
      width: 120,
      render: (p) => <RowActionBar label={`${p.name}的更多操作`} actions={actionsOf(p, open, copy)} />,
    },
  ];
}

function QuotaNote({ used, quota }: { used: number; quota: number }) {
  const premium = useStore(license, (s) => s.status.tier === "premium");
  if (quota <= 0 || used < quota)
    return (
      <Note as="p">
        已用 {used} / {quota || "—"} 份
      </Note>
    );
  return (
    <InlineAlert
      tone="info"
      title={`已存满 ${quota} 份`}
      action={
        premium ? null : (
          <Button size="sm" variant="outline" onClick={() => navigate("member")}>
            升级超级会员
          </Button>
        )
      }
    >
      {premium
        ? "可以删掉不用的配置，或用「用当前配置覆盖」更新已有的一份。"
        : "超级会员可以保存 5 份；也可以覆盖已有的一份。"}
    </InlineAlert>
  );
}

export function ProfilesPanel() {
  const { say } = useFeedback();
  const items = useStore(configSync, (s) => s.profiles);
  const quota = useStore(configSync, (s) => s.quota);
  const used = useStore(configSync, (s) => s.used);
  const loading = useStore(configSync, (s) => s.profilesLoading);
  const error = useStore(configSync, (s) => s.profilesError);
  const [dialog, setDialog] = useState<ProfileDialog | null>(null);
  const [sharedCode, setSharedCode] = useState("");
  useEffect(() => void loadProfiles(), []);
  const copy = (code: string) =>
    void copyText(code).then((ok) => say(ok ? `分享码 ${code} 已复制` : "复制失败，请手动抄下分享码"));
  const full = quota > 0 && used >= quota;
  return (
    <FormSection
      title="我的云端配置"
      description="把当前配置另存一份到云端，随时恢复；可以设恢复密码或分享给朋友"
      layout="stack"
    >
      <div className="ps-set-actions">
        <Button
          size="sm"
          disabled={full}
          disabledReason={full ? "份数已满" : undefined}
          onClick={() => setDialog({ kind: "save" })}
        >
          <CloudUpload />
          另存为云端配置
        </Button>
      </div>
      <QuotaNote used={used} quota={quota} />
      {error ? <Note tone="danger">{error}</Note> : null}
      <DataTable
        caption="我的云端配置"
        rows={items}
        rowKey={(p) => p.id}
        columns={columns(setDialog, copy)}
        pagination={{ mode: "all" }}
        rowHeight="medium"
        refreshing={loading && items.length > 0}
        emptyLabel="还没有云端配置，点「另存为云端配置」存一份"
      />
      <ProfileDialogs dialog={dialog} onClose={() => setDialog(null)} onShared={setSharedCode} />
      {sharedCode ? <SharedCodeDialog code={sharedCode} onClose={() => setSharedCode("")} /> : null}
    </FormSection>
  );
}
