// 新建 / 编辑 / 批量新建共用的端口设置项：协议、局域网、账号密码、节点、分流方式。
import { Choice, FormField, InlineAlert, Input, PasswordInput, type SelectItem, Switch } from "@ankotti/admin-ui";
import { useMemo } from "react";
import type { PortMode, PortProtocol, ProxyPort } from "../../api/types";
import { latencyText } from "../../shared/format";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { MODE_HINT, MODE_OPTIONS, PROTOCOL_OPTIONS } from "./port-draft";

/** 节点下拉里「默认」的占位值（Choice 不收空串）。 */
const CURRENT = "__current";

export type SharedSettings = Pick<ProxyPort, "protocol" | "lan" | "user" | "pass" | "node" | "mode">;

type Props<T extends SharedSettings> = { idBase: string; draft: T; set: (patch: Partial<SharedSettings>) => void };

export function PortSettingsFields<T extends SharedSettings>({ idBase, draft, set }: Props<T>) {
  const nodes = useStore(data, (s) => s.nodes);
  const nodeItems = useMemo<SelectItem[]>(
    () => [
      { value: CURRENT, label: "默认（跟随当前节点）", hint: "切换活动节点时自动跟着换" },
      ...nodes.map((n) => ({ value: n.id, label: n.name, hint: latencyText(n.latency) })),
    ],
    [nodes],
  );
  const modeItems = MODE_OPTIONS.map((m) => ({ ...m, hint: MODE_HINT[m.value] }));
  const exposed = draft.lan && !draft.user.trim();
  return (
    <>
      <FormField label="代理类型" htmlFor={`${idBase}-protocol`}>
        <Choice
          id={`${idBase}-protocol`}
          label="代理类型"
          value={draft.protocol}
          options={PROTOCOL_OPTIONS}
          onChange={(v) => set({ protocol: v as PortProtocol })}
        />
      </FormField>
      <FormField
        label="局域网可连"
        htmlFor={`${idBase}-lan`}
        hint="开：监听 0.0.0.0，同一网络的设备都能连；关：只有本机能连"
      >
        <Switch id={`${idBase}-lan`} checked={draft.lan} onCheckedChange={(lan) => set({ lan })} />
      </FormField>
      <FormField label="用户名" htmlFor={`${idBase}-user`} optional>
        <Input
          id={`${idBase}-user`}
          value={draft.user}
          placeholder="留空 = 免验证"
          autoComplete="off"
          onChange={(e) => set({ user: e.target.value })}
        />
      </FormField>
      <FormField label="密码" htmlFor={`${idBase}-pass`} optional>
        <PasswordInput
          id={`${idBase}-pass`}
          value={draft.pass}
          placeholder="留空 = 免验证"
          autoComplete="new-password"
          onChange={(e) => set({ pass: e.target.value })}
        />
      </FormField>
      <FormField label="出口节点" htmlFor={`${idBase}-node`}>
        <Choice
          id={`${idBase}-node`}
          label="出口节点"
          value={draft.node || CURRENT}
          options={nodeItems}
          onChange={(v) => set({ node: v === CURRENT ? "" : v })}
        />
      </FormField>
      <FormField label="分流方式" htmlFor={`${idBase}-mode`}>
        <Choice
          id={`${idBase}-mode`}
          label="分流方式"
          value={draft.mode}
          options={modeItems}
          onChange={(v) => set({ mode: v as PortMode })}
        />
      </FormField>
      {exposed ? (
        <div className="ps-port-full">
          <InlineAlert
            tone="warning"
            density="compact"
            title="局域网可连但没设账号密码：同一网络的任何设备都能用这个代理。"
          />
        </div>
      ) : null}
    </>
  );
}
