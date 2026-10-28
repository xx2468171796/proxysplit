// 忘记密码：手机号 + 短信验证码 + 新密码。每个手机号每天只能成功找回一次（服务端按北京日计）。
import { Button, FormField, InlineAlert, Note, PasswordInput } from "@ankotti/admin-ui";
import { ShineButton } from "@ankotti/admin-ui/motion";
import { type FormEvent, useState } from "react";
import { resetPassword } from "../../state/phone";
import { SmsFields } from "./sms-fields";

type Props = { onDone: (notice: string) => void; onBack: () => void; onNotice: (text: string) => void };

export function ForgotForm({ onDone, onBack, onNotice }: Props) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const err = await resetPassword(phone, code, password).finally(() => setBusy(false));
    if (err) return setError(err);
    onDone("密码已重置，请用新密码登录");
  };

  return (
    <form className="ps-auth-form" onSubmit={(e) => void submit(e)} noValidate>
      <Note as="p">用注册时的手机号接收验证码来设置新密码。每个手机号每天只能找回一次，请记好新密码。</Note>
      {error ? (
        <InlineAlert tone="error" title="没能重置密码" density="compact">
          {error}
        </InlineAlert>
      ) : null}
      <SmsFields
        idPrefix="ps-reset"
        purpose="reset"
        phone={phone}
        code={code}
        onPhone={setPhone}
        onCode={setCode}
        onError={setError}
        onSent={onNotice}
        disabled={busy}
        autoFocus
      />
      <FormField label="新密码" htmlFor="ps-reset-pass">
        <PasswordInput
          id="ps-reset-pass"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="至少 8 位"
          disabled={busy}
        />
      </FormField>
      <div className="ps-auth-form-actions">
        <ShineButton type="submit" disabled={busy} aria-busy={busy} hoverOnly={busy}>
          {busy ? "正在重置…" : "重置密码"}
        </ShineButton>
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          返回登录
        </Button>
      </div>
    </form>
  );
}
