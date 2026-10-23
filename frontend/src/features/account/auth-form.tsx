// 登录 / 注册表单：用户名、（注册）邮箱、密码；校验文字沿用旧版。成功后 state 会刷新授权并决定去向。
import { FormField, InlineAlert, Input, PasswordInput } from "@ankotti/admin-ui";
import { ShineButton } from "@ankotti/admin-ui/motion";
import { type FormEvent, useState } from "react";
import { login, register } from "../../state/account";

export type AuthMode = "login" | "register";

type Draft = { username: string; email: string; password: string; ref: string };

/** 提交前校验，返回错误文字（'' = 通过）。 */
function validate(mode: AuthMode, d: Draft): string {
  const username = d.username.trim();
  if (mode === "login") return username && d.password ? "" : "请输入用户名和密码";
  if (username.length < 3 || /[\s@]/.test(username)) return "用户名至少 3 位，不能包含空格或 @";
  if (!/^\S+@\S+\.\S+$/.test(d.email.trim()) || d.password.length < 8) return "请填写有效邮箱，密码至少 8 位";
  return "";
}

type Props = { mode: AuthMode; error: string; onError: (e: string) => void; disabled?: boolean };

export function AuthForm({ mode, error, onError, disabled }: Props) {
  const [draft, setDraft] = useState<Draft>({ username: "", email: "", password: "", ref: "" });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const reg = mode === "register";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validate(mode, draft);
    if (invalid) return onError(invalid);
    setBusy(true);
    onError("");
    let err: string;
    try {
      err = reg
        ? await register(draft.username, draft.email, draft.password, draft.ref)
        : await login(draft.username, draft.password);
    } catch (x) {
      err = `${reg ? "注册" : "登录"}失败：${String(x)}`;
    } finally {
      setBusy(false);
    }
    if (err) onError(err);
    else set({ password: "" });
  };

  return (
    <form className="ps-auth-form" onSubmit={(e) => void submit(e)} noValidate>
      {error ? (
        <InlineAlert tone="error" title={reg ? "注册没成功" : "登录没成功"} density="compact">
          {error}
        </InlineAlert>
      ) : null}
      <FormField label="用户名" htmlFor="ps-auth-user">
        <Input
          id="ps-auth-user"
          value={draft.username}
          onChange={(e) => set({ username: e.target.value })}
          autoComplete="username"
          placeholder="请输入用户名"
          maxLength={32}
          disabled={busy}
          autoFocus
        />
      </FormField>
      {reg ? (
        <FormField label="邮箱" htmlFor="ps-auth-email">
          <Input
            id="ps-auth-email"
            type="email"
            value={draft.email}
            onChange={(e) => set({ email: e.target.value })}
            autoComplete="email"
            placeholder="name@example.com"
            maxLength={254}
            disabled={busy}
          />
        </FormField>
      ) : null}
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
      {reg ? (
        <FormField label="邀请码（选填）" htmlFor="ps-auth-ref" hint="朋友给你的推广链接或邀请码，没有就留空">
          <Input
            id="ps-auth-ref"
            value={draft.ref}
            onChange={(e) => set({ ref: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })}
            placeholder="例如 Q78TVDW4"
            maxLength={16}
            disabled={busy}
            mono
          />
        </FormField>
      ) : null}
      <div className="ps-auth-form-actions">
        <ShineButton type="submit" disabled={busy || disabled} aria-busy={busy} hoverOnly={busy}>
          {busy ? "正在验证…" : reg ? "注册并登录" : "登录并绑定本机"}
        </ShineButton>
      </div>
    </form>
  );
}
