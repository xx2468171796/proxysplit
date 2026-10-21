// 兑换码开通：独立的兑换框（侧栏账号菜单进入）和会员中心里的一行内联表单。
import { Button, FormDialog, FormField, Input } from "@ankotti/admin-ui";
import { Ticket } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { license, redeem } from "../../state/account";

const OK_TEXT = "兑换成功，会员权益已开通";
const PLACEHOLDER = "输入兑换码，如 PS-XXXX-XXXX-XXXX";

export function RedeemDialog() {
  const { say } = useFeedback();
  const open = useStore(license, (s) => s.redeemOpen);
  const username = useStore(license, (s) => s.status.username);
  const [code, setCode] = useState("");
  if (!open) return null;
  return (
    <FormDialog
      open
      size="sm"
      title="输入兑换码 / 授权码"
      description={`当前账号 ${username || "未登录"}。输入后立即按码上的会员等级与时长开通，无需支付。同一账号对同一个兑换码只能兑换一次。`}
      submitLabel="立即兑换"
      dirty={code.trim() !== ""}
      onClose={() => license.set({ redeemOpen: false })}
      onSubmit={async () => {
        const err = await redeem(code);
        if (err) throw new Error(err);
        setCode("");
        say(OK_TEXT);
      }}
    >
      <FormField label="兑换码" htmlFor="ps-redeem-code">
        <Input
          id="ps-redeem-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={PLACEHOLDER}
          maxLength={64}
          mono
          autoFocus
        />
      </FormField>
    </FormDialog>
  );
}

/** 会员中心里的「有兑换码 / 授权码？」一行。 */
export function RedeemInline() {
  const { say } = useFeedback();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await redeem(code)
      .catch((x: unknown) => `兑换失败：${String(x)}`)
      .finally(() => setBusy(false));
    setError(err);
    if (!err) {
      setCode("");
      say(OK_TEXT);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <FormField
        label="有兑换码 / 授权码？"
        htmlFor="ps-redeem-inline"
        hint="输入后立即开通对应会员与时长，无需支付。"
        error={error || undefined}
      >
        <div className="ps-redeem-inline">
          <Input
            id="ps-redeem-inline"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={PLACEHOLDER}
            maxLength={64}
            disabled={busy}
            mono
          />
          <Button type="submit" variant="outline" loading={busy} loadingText="兑换中…" disabled={!code.trim()}>
            <Ticket />
            立即兑换
          </Button>
        </div>
      </FormField>
    </form>
  );
}
