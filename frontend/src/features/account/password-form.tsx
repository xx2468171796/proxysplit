// 修改账号密码：原密码 + 新密码（至少 8 位）。改完其它设备需重新登录。
import { Button, FormField, InlineAlert, PasswordInput } from "@ankotti/admin-ui";
import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { changePassword } from "../../state/account";

export function PasswordForm() {
  const { say } = useFeedback();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const err = await changePassword(current, next);
    setBusy(false);
    if (err) return setMsg({ ok: false, text: err });
    setCurrent("");
    setNext("");
    setMsg({ ok: true, text: "密码已修改，其它设备需重新登录" });
    say("密码修改成功");
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="ps-pw-form">
        <FormField label="原密码" htmlFor="ps-pw-current">
          <PasswordInput
            id="ps-pw-current"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
        </FormField>
        <FormField label="新密码" htmlFor="ps-pw-next">
          <PasswordInput
            id="ps-pw-next"
            placeholder="至少 8 位"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />
        </FormField>
        <Button
          type="submit"
          variant="outline"
          loading={busy}
          loadingText="修改中…"
          disabled={!current || next.length < 8}
        >
          <KeyRound />
          确认修改
        </Button>
      </div>
      {msg ? (
        <InlineAlert
          tone={msg.ok ? "success" : "error"}
          title={msg.text}
          density="compact"
          onClose={() => setMsg(null)}
        />
      ) : null}
    </form>
  );
}
