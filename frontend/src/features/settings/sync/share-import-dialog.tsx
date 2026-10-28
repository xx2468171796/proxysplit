// 输入别人的分享码 + 分享密码 → 读出配置 → 交给导入预览确认框（勾选要恢复的部分）。
import { FormDialog, FormField, Input, PasswordInput } from "@ankotti/admin-ui";
import { useState } from "react";
import { previewShared } from "../../../state/configsync";

export function ShareImportDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  return (
    <FormDialog
      open
      size="sm"
      title="导入别人分享的配置"
      description="填朋友发给你的 8 位分享码和分享密码。下一步会先给你看里面有什么，确认后才导入。"
      submitLabel="下一步：预览"
      dirty={code !== "" || password !== ""}
      onClose={onClose}
      onSubmit={async () => {
        if (code.trim().length !== 8 || !password) throw new Error("请填 8 位分享码和分享密码");
        const err = await previewShared(code, password);
        if (err) throw new Error(err);
        onClose();
      }}
    >
      <FormField label="分享码" htmlFor="share-code">
        <Input
          id="share-code"
          value={code}
          onChange={(e) =>
            setCode(
              e.target.value
                .replace(/[^A-Za-z0-9]/g, "")
                .toUpperCase()
                .slice(0, 8),
            )
          }
          placeholder="例如 7KQ2MXRP"
          maxLength={8}
          mono
          autoFocus
        />
      </FormField>
      <FormField label="分享密码" htmlFor="share-pass">
        <PasswordInput id="share-pass" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} />
      </FormField>
    </FormDialog>
  );
}
