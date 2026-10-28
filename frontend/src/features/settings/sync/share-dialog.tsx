// 分享云端配置：设分享密码 → 生成分享码 → 单独的弹框显示分享码（FormDialog 提交成功会自己关掉）。
import { Button, CopyField, Dialog, FormDialog, FormField, PasswordInput } from "@ankotti/admin-ui";
import { useState } from "react";
import { syncApi } from "../../../api/sync";
import type { ConfigProfile } from "../../../api/types-account";
import { loadProfiles } from "../../../state/configsync";
import { needRestore, RestoreField } from "./restore-field";

type Props = { p: ConfigProfile; onClose: () => void; onShared: (code: string) => void };

export function ShareDialog({ p, onClose, onShared }: Props) {
  const [password, setPassword] = useState("");
  const [restore, setRestore] = useState("");
  return (
    <FormDialog
      open
      size="sm"
      title={`分享「${p.name}」`}
      description="设一个分享密码，别人要同时有分享码和密码才能导入。分享出去的配置不含你的账号和 POWER云 官方线路。"
      submitLabel="生成分享码"
      dirty={password !== ""}
      onClose={onClose}
      onSubmit={async () => {
        if (password.length < 6) throw new Error("分享密码至少 6 位");
        needRestore(p, restore);
        const r = await syncApi.shareProfile(p.id, password, restore);
        if (r.err) throw new Error(r.err);
        await loadProfiles();
        onShared(r.code);
      }}
    >
      <FormField label="分享密码" htmlFor="share-new-pass" hint="6 到 64 位">
        <PasswordInput
          id="share-new-pass"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={64}
          autoFocus
        />
      </FormField>
      <RestoreField p={p} value={restore} onChange={setRestore} />
    </FormDialog>
  );
}

export function SharedCodeDialog({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <Dialog
      open
      size="sm"
      title="分享码已生成"
      description="把分享码和分享密码一起发给朋友，他在 ProxySplit「配置与同步」里点「输入分享码」就能导入。随时可以取消分享。"
      onClose={onClose}
      footer={<Button onClick={onClose}>好的</Button>}
    >
      <CopyField label="分享码" value={code} note="分享密码请另外告诉对方，这里不会显示它" />
    </Dialog>
  );
}
