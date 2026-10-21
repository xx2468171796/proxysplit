// 登录页（不在 AdminShell 里，AuthLayout 认证页）：登录 / 免费注册两个页签，注册显示试用三步；
// 「用 POWER云 账号登录」（中转站渠道叫「用 AI 编程官网账号登录」）走浏览器授权。
import { AuthLayout, Button, Note, Steps, Tabs } from "@ankotti/admin-ui";
import { Globe } from "lucide-react";
import { useState } from "react";
import { UpdateBanner } from "../../app/banners";
import { useFeedback } from "../../app/use-feedback";
import logo from "../../assets/proxysplit-logo.svg";
import { useStore } from "../../shared/store";
import { isAigwChannel, license } from "../../state/account";
import { loginPowerVPN } from "../../state/account-sso";
import { AuthForm, type AuthMode } from "./auth-form";
import "./account.css";

const MODES = [
  { value: "login", label: "登录" },
  { value: "register", label: "免费注册" },
];

const TRIAL_STEPS = [
  { key: "account", label: "填写账号密码" },
  { key: "bind", label: "自动绑定当前电脑" },
  { key: "trial", label: "领取试用或选套餐", description: "符合条件领取试用，否则选择套餐" },
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

export function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const ssoBusy = useStore(license, (s) => s.powervpnBusy);
  const reg = mode === "register";

  return (
    <div className="ps-gate">
      <UpdateBanner />
      <AuthLayout
        logo={<img src={logo} alt="" className="ps-auth-logo" />}
        title="ProxySplit"
        description={reg ? "注册后即可登录，符合条件自动获得 3 天试用" : "登录后使用你的授权设备"}
        footer={
          reg
            ? "邮箱当前不做验证；同一电脑仅能领取一次试用，但始终可以注册新账号并购买套餐。主板等硬件信息只生成摘要，不上传原始序列号。"
            : "设备名额与会员状态由服务端校验。主板等硬件信息只生成摘要，不上传原始序列号。"
        }
      >
        <div className="ps-auth-form">
          <Tabs
            label="登录方式"
            value={mode}
            onValueChange={(v) => {
              setMode(v === "register" ? "register" : "login");
              setError("");
            }}
            items={MODES}
          />
          {reg ? (
            <Steps label="注册即可开始" steps={TRIAL_STEPS} current="account" size="sm" orientation="vertical" />
          ) : null}
          <AuthForm mode={mode} error={error} onError={setError} disabled={ssoBusy} />
          {reg ? null : <SsoLogin onError={setError} />}
        </div>
      </AuthLayout>
    </div>
  );
}
