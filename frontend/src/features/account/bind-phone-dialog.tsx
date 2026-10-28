// 绑定手机号弹框：老账号每次登录后弹（「下次再说」只关这一次），账号区也能主动打开。
import { Button, FormDialog } from "@ankotti/admin-ui";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
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
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  return (
    <FormDialog
      open
      size="sm"
      title="绑定手机号"
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
        const err = await bindPhone(phone, code);
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
    </FormDialog>
  );
}
