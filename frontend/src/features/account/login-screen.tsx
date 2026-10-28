// 登录页（不在 AdminShell 里，AuthLayout 认证页）：登录 / 手机号注册两个页签，外加「忘记密码」短信找回；
// 「用 POWER云 账号登录」（中转站渠道叫「用 AI 编程官网账号登录」）走浏览器授权。
import { AuthLayout, Button, Note, Steps, Tabs } from "@ankotti/admin-ui";
import { Globe } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import logo from "../../assets/proxysplit-logo.svg";
import { useStore } from "../../shared/store";
import { isAigwChannel, license } from "../../state/account";
import { loginPowerVPN } from "../../state/account-sso";
import { AuthForm, type AuthMode } from "./auth-form";
import { ForgotForm } from "./forgot-form";
import "./account.css";

const MODES = [
  { value: "login", label: "登录" },
  { value: "register", label: "免费注册" },
];

const SIGNUP_STEPS = [
  { key: "account", label: "手机号验证 + 设置账号密码" },
  { key: "bind", label: "自动绑定当前电脑" },
  { key: "free", label: "免费版立即可用", description: "开通会员可多绑设备、云端同步配置" },
];

function SsoLogin({ onError }: { onError: (e: string) => void }) {
  const { say } = useFeedback();
  const status = useStore(license, (s) => s.status);
  const busy = useStore(license, (s) => s.powervpnBusy);
  const autoBusy = useStore(license, (s) => s.autoLoginBusy);
  const aigw = isAigwChannel(status);
  let text = aigw ? "用 AI 编程官网账号登录" : "用 POWER云 账号登录";
  if (autoBusy) text = "正在用 AI 编程官网的下载自动登录…";
  else if (busy) text = "请在浏览器中完成登录授权…";

  const run = async () => {
    onError("");
    const r = await loginPowerVPN();
    if (r.err) onError(r.err);
    else say(r.notice);
  };
  return (
    <>
      <Button variant="outline" loading={busy} loadingText={text} onClick={() => void run()}>
        <Globe />
        {text}
      </Button>
      {aigw ? <Note as="p">会打开浏览器，用 ai.zygskins.cn 的账号登录并点「同意」，完成后自动回到这里。</Note> : null}
    </>
  );
}

function description(mode: AuthMode): string {
  if (mode === "register") return "用手机号注册，免费版全部功能可用（1 台设备）";
  if (mode === "forgot") return "用手机短信验证码设置新密码";
  return "登录后使用你的授权设备";
}

export function LoginScreen() {
  const { say } = useFeedback();
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const ssoBusy = useStore(license, (s) => s.powervpnBusy);
  const reg = mode === "register";
  const switchTo = (next: AuthMode) => {
    setMode(next);
    setError("");
  };
  const notice = (t: string) => say(t, "info");

  return (
    <div className="ps-gate">
      <AuthLayout
        logo={<img src={logo} alt="" className="ps-auth-logo" />}
        title="ProxySplit"
        description={description(mode)}
        footer="设备名额与会员状态由服务端校验。手机号只用于登录和找回密码；主板等硬件信息只生成摘要，不上传原始序列号。"
      >
        <div className="ps-auth-form">
          {mode === "forgot" ? (
            <ForgotForm
              onBack={() => switchTo("login")}
              onNotice={notice}
              onDone={(t) => {
                switchTo("login");
                say(t, "success");
              }}
            />
          ) : (
            <>
              <Tabs
                label="登录方式"
                value={mode}
                onValueChange={(v) => switchTo(v === "register" ? "register" : "login")}
                items={MODES}
              />
              {reg ? (
                <Steps label="注册即可开始" steps={SIGNUP_STEPS} current="account" size="sm" orientation="vertical" />
              ) : null}
              <AuthForm
                mode={reg ? "register" : "login"}
                error={error}
                onError={setError}
                onNotice={notice}
                disabled={ssoBusy}
              />
              {reg ? null : (
                <>
                  <Button variant="text" size="sm" onClick={() => switchTo("forgot")}>
                    忘记密码？用手机号找回（每天一次）
                  </Button>
                  <SsoLogin onError={setError} />
                </>
              )}
            </>
          )}
        </div>
      </AuthLayout>
    </div>
  );
}
