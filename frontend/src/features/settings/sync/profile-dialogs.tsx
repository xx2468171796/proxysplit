// 云端配置的各个弹框：另存为、改名、覆盖、删除、取消分享、分享（设分享密码 → 显示分享码）、恢复密码、恢复（有密码先输密码）。
import { Button, ConfirmDialog, FormDialog, FormField, Input, PasswordInput } from "@ankotti/admin-ui";
import { useState } from "react";
import { syncApi } from "../../../api/sync";
import type { ConfigProfile } from "../../../api/types-account";
import { useFeedback } from "../../../app/use-feedback";
import { previewProfile, profileAction } from "../../../state/configsync";
import { ShareDialog } from "./share-dialog";

export type ProfileDialog =
  | { kind: "save" }
  | { kind: "rename" | "overwrite" | "delete" | "unshare" | "share" | "password" | "restore"; p: ConfigProfile };

type Props = { dialog: ProfileDialog | null; onClose: () => void; onShared: (code: string) => void };

const fail = (err: string) => {
  if (err) throw new Error(err);
};

function NameDialog({ p, onClose }: { p?: ConfigProfile; onClose: () => void }) {
  const { say } = useFeedback();
  const [name, setName] = useState(p?.name ?? "");
  return (
    <FormDialog
      open
      size="sm"
      title={p ? `改名「${p.name}」` : "另存为云端配置"}
      description={
        p ? "换个好认的名字。" : "把本机现在的配置存一份到云端，比如「公司电脑」「家里」。不含账号和 POWER云 官方线路。"
      }
      submitLabel={p ? "保存" : "存到云端"}
      dirty={name.trim() !== "" && name !== p?.name}
      onClose={onClose}
      onSubmit={async () => {
        fail(await profileAction(() => (p ? syncApi.renameProfile(p.id, name) : syncApi.saveProfile(name))));
        say(p ? "已改名" : "已存到云端", "success");
      }}
    >
      <FormField label="名称" htmlFor="profile-name" hint="最多 40 个字">
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
      </FormField>
    </FormDialog>
  );
}

function PasswordDialog({ p, onClose }: { p: ConfigProfile; onClose: () => void }) {
  const { say } = useFeedback();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = async (value: string) => {
    if (p.locked && !current) throw new Error("请先输入原来的恢复密码");
    fail(await profileAction(() => syncApi.setProfilePassword(p.id, value, current)));
    say(value ? "恢复密码已设置" : "恢复密码已清除", "success");
    onClose();
  };
  return (
    <FormDialog
      open
      size="sm"
      title={p.locked ? `修改「${p.name}」的恢复密码` : `给「${p.name}」设恢复密码`}
      description="设了以后，任何设备（包括借你账号的人）恢复这份配置都要输入它。和分享密码互不影响。"
      submitLabel="保存"
      dirty={next !== ""}
      onClose={onClose}
      dangerAction={
        p.locked ? (
          <Button
            variant="destructive-outline"
            onClick={() => void save("").catch((e: Error) => say(e.message, "error"))}
          >
            清除恢复密码
          </Button>
        ) : undefined
      }
      onSubmit={async () => {
        if (next.length < 4) throw new Error("恢复密码至少 4 位");
        await save(next);
      }}
    >
      {p.locked ? (
        <FormField label="原恢复密码" htmlFor="restore-current">
          <PasswordInput id="restore-current" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </FormField>
      ) : null}
      <FormField label="新恢复密码" htmlFor="restore-next" hint="4 到 64 位">
        <PasswordInput id="restore-next" value={next} onChange={(e) => setNext(e.target.value)} maxLength={64} />
      </FormField>
    </FormDialog>
  );
}

function RestoreDialog({ p, onClose }: { p: ConfigProfile; onClose: () => void }) {
  const [password, setPassword] = useState("");
  return (
    <FormDialog
      open
      size="sm"
      title={`恢复「${p.name}」`}
      description="下一步会先给你看里面有什么，可以只勾选部分恢复。恢复前会自动备份本机当前配置。"
      submitLabel="下一步：预览"
      dirty
      onClose={onClose}
      onSubmit={async () => {
        if (p.locked && !password) throw new Error("这份配置设了恢复密码，请先输入");
        fail(await previewProfile(p.id, password));
        onClose();
      }}
    >
      {p.locked ? (
        <FormField label="恢复密码" htmlFor="restore-pass">
          <PasswordInput id="restore-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </FormField>
      ) : null}
    </FormDialog>
  );
}

const CONFIRMS = {
  overwrite: {
    title: "用本机当前配置覆盖",
    label: "覆盖",
    text: "云端这份会换成本机现在的配置，分享码和恢复密码保持不变。",
  },
  delete: { title: "删除云端配置", label: "删除", text: "删除后无法找回，已发出去的分享码也会失效。" },
  unshare: { title: "取消分享", label: "取消分享", text: "分享码会立即失效，别人已经导入的不受影响。" },
} as const;

function ConfirmProfile({ kind, p, onClose }: { kind: keyof typeof CONFIRMS; p: ConfigProfile; onClose: () => void }) {
  const { say } = useFeedback();
  const c = CONFIRMS[kind];
  const call = { overwrite: syncApi.overwriteProfile, delete: syncApi.deleteProfile, unshare: syncApi.unshareProfile }[
    kind
  ];
  return (
    <ConfirmDialog
      open
      title={`${c.title}「${p.name}」？`}
      description={c.text}
      tone={kind === "overwrite" ? "warning" : "danger"}
      destructive={kind === "delete"}
      confirmLabel={c.label}
      onConfirm={async () => {
        fail(await profileAction(() => call(p.id)));
        say("已完成", "success");
      }}
      onClose={onClose}
    />
  );
}

export function ProfileDialogs({ dialog, onClose, onShared }: Props) {
  if (!dialog) return null;
  if (dialog.kind === "save") return <NameDialog onClose={onClose} />;
  const { p } = dialog;
  switch (dialog.kind) {
    case "rename":
      return <NameDialog p={p} onClose={onClose} />;
    case "share":
      return <ShareDialog p={p} onClose={onClose} onShared={onShared} />;
    case "password":
      return <PasswordDialog p={p} onClose={onClose} />;
    case "restore":
      return <RestoreDialog p={p} onClose={onClose} />;
    default:
      return <ConfirmProfile kind={dialog.kind} p={p} onClose={onClose} />;
  }
}
