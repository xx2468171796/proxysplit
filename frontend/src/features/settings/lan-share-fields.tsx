// 对局域网开放后的端口 / 类型 / 账号：输入框离开时才保存（每次保存会重启内核）。
import { Choice, FormField, FormSection, Input, Note, NumberInput, PasswordInput } from "@ankotti/admin-ui";
import { useEffect, useState } from "react";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { system } from "../../state/system";
import { useSaveSettings } from "./setting-fields";

const LAN_TYPES = [
  { value: "mixed", label: "混合 SOCKS5+HTTP" },
  { value: "socks", label: "SOCKS5" },
  { value: "http", label: "HTTP" },
];
const TYPE_TEXT: Record<string, string> = { http: "HTTP", socks: "SOCKS5" };

/** 跟着已保存的值走的草稿：外面改了（例如导入配置）就同步过来。 */
function useDraft<T>(saved: T): [T, (v: T) => void] {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  return [draft, setDraft];
}

export function LanShareFields() {
  const save = useSaveSettings();
  const lanIP = useStore(system, (s) => s.lanIP);
  const port = useStore(data, (s) => s.settings.lanPort);
  const type = useStore(data, (s) => s.settings.lanType);
  const user = useStore(data, (s) => s.settings.lanUser);
  const pass = useStore(data, (s) => s.settings.lanPass);
  const [portDraft, setPortDraft] = useDraft<number | null>(port);
  const [userDraft, setUserDraft] = useDraft(user);
  const [passDraft, setPassDraft] = useDraft(pass);

  const savePort = () => {
    if (portDraft && portDraft !== port) save({ lanPort: portDraft });
    else setPortDraft(port);
  };
  const authText = user ? "连接需填此用户名和密码。" : "当前免验证，任何同网设备都可用，建议设个密码。";

  return (
    <div className="ps-set-sub">
      <FormSection>
        <FormField label="端口" htmlFor="lan-port">
          <NumberInput id="lan-port" value={portDraft} min={1} max={65535} onChange={setPortDraft} onBlur={savePort} />
        </FormField>
        <FormField label="类型" htmlFor="lan-type">
          <Choice label="代理类型" value={type || "mixed"} options={LAN_TYPES} onChange={(v) => save({ lanType: v })} />
        </FormField>
        <FormField label="用户名" htmlFor="lan-user" optional>
          <Input
            id="lan-user"
            value={userDraft}
            placeholder="留空 = 免验证"
            autoComplete="off"
            onChange={(e) => setUserDraft(e.target.value)}
            onBlur={() => userDraft !== user && save({ lanUser: userDraft.trim() })}
          />
        </FormField>
        <FormField label="密码" htmlFor="lan-pass" optional>
          <PasswordInput
            id="lan-pass"
            value={passDraft}
            placeholder="留空 = 免验证"
            autoComplete="new-password"
            onChange={(e) => setPassDraft(e.target.value)}
            onBlur={() => passDraft !== pass && save({ lanPass: passDraft })}
          />
        </FormField>
      </FormSection>
      <Note as="p" className="ps-set-note">
        局域网设备代理设为 <b>{`${lanIP || "本机IP"}:${port || 7890}`}</b>（{TYPE_TEXT[type] ?? "SOCKS5 / HTTP"}）。
        {authText}
      </Note>
    </div>
  );
}
