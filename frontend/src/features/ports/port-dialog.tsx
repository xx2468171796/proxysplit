// 新建 / 编辑一个端口：名称、端口号 + 共用设置项。
import { FormDialog, FormField, Input, NumberInput } from "@ankotti/admin-ui";
import { useState } from "react";
import type { ProxyPort, ProxyPortStatus } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { ports, savePort } from "../../state/ports";
import { emptyPort, PORT_MAX, PORT_MIN, validatePort } from "./port-draft";
import { PortSettingsFields } from "./port-fields";

function toDraft(p: ProxyPortStatus): ProxyPort {
  const { id, name, enabled, port, protocol, lan, user, pass, mode, node } = p;
  return { id, name, enabled, port, protocol, lan, user, pass, mode, node };
}

export function PortDialog({ port, onClose }: { port: ProxyPortStatus | null; onClose: () => void }) {
  const { say } = useFeedback();
  const list = useStore(ports, (s) => s.list);
  const [initial] = useState<ProxyPort>(() => (port ? toDraft(port) : emptyPort(list)));
  const [draft, setDraft] = useState(initial);
  const set = (p: Partial<ProxyPort>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <FormDialog
      open
      size="lg"
      title={port ? `编辑「${port.name}」` : "新建端口"}
      description="每个端口是一条独立线路：自己的出口节点和分流方式，互不影响。保存后若端口正在运行会自动重启。"
      submitLabel={port ? "保存" : "创建并启动"}
      dirty={JSON.stringify(initial) !== JSON.stringify(draft)}
      onClose={onClose}
      onSubmit={async () => {
        const bad = validatePort(draft);
        if (bad) throw new Error(bad);
        const err = await savePort({ ...draft, name: draft.name.trim(), user: draft.user.trim() });
        if (err) throw new Error(err);
        say(port ? `已保存「${draft.name}」` : `已创建「${draft.name}」`);
      }}
    >
      <FormField label="名称" htmlFor="port-name" required>
        <Input
          id="port-name"
          value={draft.name}
          placeholder="如 浏览器1"
          onChange={(e) => set({ name: e.target.value })}
        />
      </FormField>
      <FormField label="端口" htmlFor="port-number" required>
        <NumberInput
          id="port-number"
          value={draft.port}
          min={PORT_MIN}
          max={PORT_MAX}
          onChange={(n) => set({ port: n ?? 0 })}
        />
      </FormField>
      <PortSettingsFields idBase="port" draft={draft} set={set} />
    </FormDialog>
  );
}
