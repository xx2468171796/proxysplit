// 网页注册表单：手机号 + 短信验证码 + 用户名 + 密码（+ 邀请码）。试用在客户端首次登录时按硬件发放，网页只建账号。
// admin-ui-audit-ignore-file raw-control: 官网是 qiantai 前台页，不加载 admin-ui 样式，控件用 qiantai 的 q-btn / q-input 类
import { Card } from "qiantai";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { isPhone, normalizePhone, readReferralCode, registerWeb, sendRegisterCode, validateRegister } from "../api";

type Msg = { ok: boolean; text: string } | null;

/** 获取验证码的倒计时：start(n) 开始 n 秒，返回剩余秒数（0 = 可以再发）。 */
function useSecondsLeft(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

export function RegisterForm() {
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [left, startCountdown] = useSecondsLeft();
  const phoneRef = useRef<HTMLInputElement>(null);

  const sendCode = async () => {
    const phone = normalizePhone(phoneRef.current?.value ?? "");
    if (!isPhone(phone)) return setMsg({ ok: false, text: "请先输入正确的 11 位手机号。" });
    setSending(true);
    setMsg(null);
    const r = await sendRegisterCode(phone).finally(() => setSending(false));
    if (r.cooldown > 0) startCountdown(r.cooldown);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "验证码已发送，5 分钟内有效。" });
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const input = {
      phone: normalizePhone(String(data.get("phone") ?? "")),
      code: String(data.get("code") ?? "").trim(),
      username: String(data.get("username") ?? "").trim(),
      password: String(data.get("password") ?? ""),
      ref: String(data.get("ref") ?? "").trim(),
    };
    const invalid = validateRegister(input);
    if (invalid) return setMsg({ ok: false, text: invalid });
    setBusy(true);
    const err = await registerWeb(input).finally(() => setBusy(false));
    if (err) return setMsg({ ok: false, text: err });
    form.reset();
    startCountdown(0);
    setMsg({ ok: true, text: "注册好了。下载软件，用这个账号登录就能领 3 天试用。" });
  };

  return (
    <Card kind="plain" className="ps-register">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="ps-register-copy">
          <h3>先在网页上注册</h3>
          <p className="q-muted">用手机号收验证码就能注册，忘记密码也能用这个手机号找回。</p>
        </div>
        <div className="ps-register-phone">
          <input
            ref={phoneRef}
            className="q-input"
            name="phone"
            type="tel"
            inputMode="numeric"
            placeholder="手机号"
            autoComplete="tel-national"
            maxLength={20}
            aria-label="手机号"
          />
          <button
            className="q-btn"
            type="button"
            onClick={() => void sendCode()}
            disabled={sending || left > 0}
            aria-busy={sending}
          >
            {sending ? "发送中…" : left > 0 ? `${left} 秒后重发` : "获取验证码"}
          </button>
        </div>
        <input
          className="q-input"
          name="code"
          inputMode="numeric"
          placeholder="短信验证码（6 位）"
          autoComplete="one-time-code"
          maxLength={6}
          aria-label="短信验证码"
        />
        <input
          className="q-input"
          name="username"
          placeholder="用户名（3–32 位）"
          autoComplete="username"
          aria-label="用户名"
        />
        <input
          className="q-input"
          name="password"
          type="password"
          placeholder="密码（至少 8 位）"
          autoComplete="new-password"
          aria-label="密码"
        />
        <input
          className="q-input"
          name="ref"
          defaultValue={readReferralCode()}
          placeholder="邀请码（选填）"
          maxLength={16}
          aria-label="邀请码"
        />
        <button className="q-btn" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "注册中…" : "注册"}
        </button>
        {msg ? (
          <p className={`ps-register-msg${msg.ok ? " is-ok" : " is-bad"}`} role="status">
            {msg.text}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
