// 绑定手机号弹框：老账号每次登录后弹（「下次再说」只关这一次），账号区也能主动打开。
import { Button, FormDialog, FormField, PasswordInput } from "@ankotti/admin-ui";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { bindPhone } from "../../state/phone";
import { closeBindPhone, prompts } from "../../state/prompts";
import { SmsFields } from "./sms-fields";

export function BindPhoneDialog() {
  const open = useStore(prompts, (s) => s.bindPhoneOpen);
  if (!open) return null;
  return <BindPhoneForm />;
}

function BindPhoneForm() {
  const { say } = useFeedback();
  // 已绑过手机号 = 换绑，要当前登录密码（服务端同样校验）。
  const rebind = useStore(license, (s) => s.status.phoneBound === true);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [error, setError] = useState("");
  return (
    <FormDialog
      open
      size="sm"
      title={rebind ? "更换手机号" : "绑定手机号"}
      description="绑定后可以用手机号登录，忘记密码时也能用短信找回。手机号只用于登录和找回密码。"
      submitLabel="绑定"
      dirty={phone !== "" || code !== ""}
      error={error}
      onClose={closeBindPhone}
      secondaryActions={
        <Button variant="ghost" onClick={closeBindPhone}>
          下次再说
        </Button>
      }
      onSubmit={async () => {
        if (rebind && !current) throw new Error("请输入当前登录密码");
        const err = await bindPhone(phone, code, current);
        if (err) throw new Error(err);
        say("手机号已绑定，之后可以用手机号登录", "success");
      }}
    >
      <SmsFields
        idPrefix="ps-bind"
        purpose="bind"
        phone={phone}
        code={code}
        onPhone={setPhone}
        onCode={setCode}
        onError={setError}
        onSent={(t) => say(t, "info")}
        autoFocus
      />
      {rebind ? (
        <FormField label="当前登录密码" htmlFor="ps-bind-current" hint="更换已绑定的手机号需要验证登录密码">
          <PasswordInput id="ps-bind-current" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
      ) : null}
    </FormDialog>
  );
}
