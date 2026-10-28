// 登录 / 注册表单。登录：用户名或手机号 + 密码；注册：手机号 + 短信验证码 + 用户名 + 密码（+ 选填邀请码）。
// 成功后 state 会刷新授权并决定去向（免费用户直接进主界面）。
import { FormField, InlineAlert, Input, PasswordInput } from "@ankotti/admin-ui";
import { ShineButton } from "@ankotti/admin-ui/motion";
import { type FormEvent, useState } from "react";
import { login, registerPhone } from "../../state/account";
import { codeError, phoneError } from "../../state/phone";
import { SmsFields } from "./sms-fields";

export type AuthMode = "login" | "register" | "forgot";

type Draft = { account: string; phone: string; code: string; username: string; password: string; ref: string };

/** 提交前校验，返回错误文字（'' = 通过）。 */
function validate(reg: boolean, d: Draft): string {
  if (!reg) return d.account.trim() && d.password ? "" : "请输入用户名或手机号，以及密码";
  const username = d.username.trim();
  const bad = phoneError(d.phone) || codeError(d.code);
  if (bad) return bad;
  if (username.length < 3 || /[\s@]/.test(username) || /^1\d{10}$/.test(username))
    return "用户名至少 3 位，不能有空格或 @，也不能是手机号";
  return d.password.length < 8 ? "密码至少 8 位" : "";
}

type Props = {
  mode: "login" | "register";
  error: string;
  onError: (e: string) => void;
  onNotice: (text: string) => void;
  disabled?: boolean;
};

function RefField({ value, onChange, busy }: { value: string; onChange: (v: string) => void; busy: boolean }) {
  return (
    <FormField label="邀请码（选填）" htmlFor="ps-auth-ref" hint="朋友给你的推广链接或邀请码，没有就留空">
      <Input
        id="ps-auth-ref"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
        placeholder="例如 Q78TVDW4"
        maxLength={16}
        disabled={busy}
        mono
      />
    </FormField>
  );
}

export function AuthForm({ mode, error, onError, onNotice, disabled }: Props) {
  const [draft, setDraft] = useState<Draft>({ account: "", phone: "", code: "", username: "", password: "", ref: "" });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const reg = mode === "register";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validate(reg, draft);
    if (invalid) return onError(invalid);
    setBusy(true);
    onError("");
    let err: string;
    try {
      err = reg ? await registerPhone(draft) : await login(draft.account, draft.password);
    } catch (x) {
      err = `${reg ? "注册" : "登录"}失败：${String(x)}`;
    } finally {
      setBusy(false);
    }
    if (err) onError(err);
    else set({ password: "", code: "" });
  };

  return (
    <form className="ps-auth-form" onSubmit={(e) => void submit(e)} noValidate>
      {error ? (
        <InlineAlert tone="error" title={reg ? "注册没成功" : "登录没成功"} density="compact">
          {error}
        </InlineAlert>
      ) : null}
      {reg ? (
        <SmsFields
          idPrefix="ps-reg"
          purpose="register"
          phone={draft.phone}
          code={draft.code}
          onPhone={(phone) => set({ phone })}
          onCode={(code) => set({ code })}
          onError={onError}
          onSent={onNotice}
          disabled={busy}
          autoFocus
        />
      ) : null}
      <FormField label={reg ? "用户名" : "用户名或手机号"} htmlFor="ps-auth-user">
        <Input
          id="ps-auth-user"
          value={reg ? draft.username : draft.account}
          onChange={(e) => set(reg ? { username: e.target.value } : { account: e.target.value })}
          autoComplete="username"
          placeholder={reg ? "登录时也可以用手机号" : "请输入用户名或手机号"}
          maxLength={32}
          disabled={busy}
          autoFocus={!reg}
        />
      </FormField>
      <FormField label="密码" htmlFor="ps-auth-pass">
        <PasswordInput
          id="ps-auth-pass"
          value={draft.password}
          onChange={(e) => set({ password: e.target.value })}
          autoComplete={reg ? "new-password" : "current-password"}
          placeholder={reg ? "至少 8 位" : "请输入密码"}
          disabled={busy}
        />
      </FormField>
      {reg ? <RefField value={draft.ref} onChange={(ref) => set({ ref })} busy={busy} /> : null}
      <div className="ps-auth-form-actions">
        <ShineButton type="submit" disabled={busy || disabled} aria-busy={busy} hoverOnly={busy}>
          {busy ? "正在验证…" : reg ? "注册并登录" : "登录并绑定本机"}
        </ShineButton>
      </div>
    </form>
  );
}
