// 手机号 + 短信验证码两行：「获取验证码」发出后按服务端给的冷却秒数倒计时（默认 60）。注册、找回密码、绑定手机号共用。
import { Button, FormField, Input } from "@ankotti/admin-ui";
import { useEffect, useState } from "react";
import type { SmsPurpose } from "../../api/types-account";
import { sendSmsCode } from "../../state/phone";

type Props = {
  idPrefix: string;
  purpose: SmsPurpose;
  phone: string;
  code: string;
  onPhone: (v: string) => void;
  onCode: (v: string) => void;
  onError: (e: string) => void;
  onSent?: (text: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, (seconds) => setLeft(seconds)];
}

export function SmsFields({
  idPrefix,
  purpose,
  phone,
  code,
  onPhone,
  onCode,
  onError,
  onSent,
  disabled,
  autoFocus,
}: Props) {
  const [left, start] = useCountdown();
  const [sending, setSending] = useState(false);
  const send = async () => {
    onError("");
    setSending(true);
    const { err, cooldown } = await sendSmsCode(phone, purpose).finally(() => setSending(false));
    if (err) return onError(err);
    start(cooldown);
    onSent?.("验证码已发送，5 分钟内有效");
  };
  return (
    <>
      <FormField label="手机号" htmlFor={`${idPrefix}-phone`}>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => onPhone(e.target.value.replace(/[^\d+\s-]/g, ""))}
          autoComplete="tel"
          placeholder="11 位手机号"
          maxLength={16}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </FormField>
      <FormField label="短信验证码" htmlFor={`${idPrefix}-code`}>
        <div className="ps-sms-row">
          <Input
            id={`${idPrefix}-code`}
            inputMode="numeric"
            value={code}
            onChange={(e) => onCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            autoComplete="one-time-code"
            placeholder="6 位数字"
            maxLength={6}
            disabled={disabled}
            mono
          />
          <Button
            type="button"
            variant="outline"
            loading={sending}
            loadingText="发送中…"
            disabled={disabled || left > 0}
            onClick={() => void send()}
          >
            {left > 0 ? `${left} 秒后重发` : "获取验证码"}
          </Button>
        </div>
      </FormField>
    </>
  );
}
