// 设了恢复密码的云端配置：改名 / 覆盖 / 删除 / 分享 / 取消分享前都要输入恢复密码（服务端校验并计错误次数）。
import { FormField, PasswordInput } from "@ankotti/admin-ui";
import type { ConfigProfile } from "../../../api/types-account";

export function RestoreField({
  p,
  value,
  onChange,
}: {
  p: ConfigProfile;
  value: string;
  onChange: (v: string) => void;
}) {
  if (!p.locked) return null;
  return (
    <FormField label="恢复密码" htmlFor="profile-restore-pass" hint="这份配置设了恢复密码，修改前要先输入">
      <PasswordInput
        id="profile-restore-pass"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={64}
      />
    </FormField>
  );
}

export function needRestore(p: ConfigProfile, value: string): void {
  if (p.locked && !value) throw new Error("这份配置设了恢复密码，请先输入");
}
