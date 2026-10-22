// 会员插槽（锚点 #pricing）：套餐（服务端实时读取）+ 网页注册。试用在客户端首次登录时按硬件发放，网页只建账号。
import { Card, Section } from "qiantai";
import { type FormEvent, useState } from "react";
import { registerWeb, validateRegister } from "../api";
import { usePlans } from "../use-site-data";
import { PlanCard } from "./plan-card";

function Plans() {
  const state = usePlans();
  if (state.status === "loading") return <p className="ps-note">正在读取套餐…</p>;
  if (state.status === "error") return <p className="ps-note">套餐暂时读不到，可以下载软件后在「会员中心」查看。</p>;
  if (!state.plans.length) return <p className="ps-note">套餐即将上架，现在下载可以先免费试用。</p>;
  return (
    <div className="ps-plans">
      {state.plans.map((p) => (
        <PlanCard key={p.code || p.name} plan={p} />
      ))}
    </div>
  );
}

type Msg = { ok: boolean; text: string } | null;

function RegisterForm() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const input = {
      username: String(data.get("username") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    };
    const invalid = validateRegister(input);
    if (invalid) return setMsg({ ok: false, text: invalid });
    setBusy(true);
    const err = await registerWeb(input).finally(() => setBusy(false));
    if (err) return setMsg({ ok: false, text: err });
    form.reset();
    setMsg({ ok: true, text: "注册好了。下载软件，用这个账号登录就能领 3 天试用。" });
  };
  return (
    <Card kind="plain" className="ps-register">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="ps-register-copy">
          <h3>先在网页上注册</h3>
          <p className="q-muted">用户名、邮箱和密码就够了，不用验证邮箱。</p>
        </div>
        <input
          className="q-input"
          name="username"
          placeholder="用户名（3–32 位）"
          autoComplete="username"
          aria-label="用户名"
        />
        <input
          className="q-input"
          name="email"
          type="email"
          placeholder="邮箱"
          autoComplete="email"
          aria-label="邮箱"
        />
        <input
          className="q-input"
          name="password"
          type="password"
          placeholder="密码（至少 8 位）"
          autoComplete="new-password"
          aria-label="密码"
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

export function PricingSlot() {
  return (
    <Section title="会员" desc="新用户先免费用 3 天，同一台电脑只能领一次。普通会员最多 3 台电脑，超级会员最多 8 台。">
      <Plans />
      <RegisterForm />
      <p className="q-muted ps-fineprint">
        目前只支持支付宝。付款后由服务器校验并自动开通，支付密钥不会存放在软件里；设备可以在软件的「账号与设备」里解绑。
      </p>
    </Section>
  );
}
