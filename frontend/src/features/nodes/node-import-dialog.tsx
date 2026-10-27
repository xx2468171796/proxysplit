// 添加节点：链接导入（一次多条，重复自动跳过）/ 手动添加 SOCKS5、HTTP 代理。
import {
  Choice,
  FormDialog,
  FormField,
  FormSection,
  Input,
  NumberInput,
  PasswordInput,
  Tabs,
  Textarea,
} from "@ankotti/admin-ui";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { addManualNode, addNodes, type ManualNode } from "../../state/nodes";

const TYPES = [
  { value: "socks", label: "SOCKS5" },
  { value: "http", label: "HTTP" },
];

const EMPTY: ManualNode = { type: "socks", name: "", server: "", port: 1080, username: "", password: "" };

function ManualFields({ value, set }: { value: ManualNode; set: (p: Partial<ManualNode>) => void }) {
  return (
    <FormSection>
      <FormField label="类型" htmlFor="mn-type">
        <Choice id="mn-type" label="类型" value={value.type} onChange={(type) => set({ type })} options={TYPES} />
      </FormField>
      <FormField label="名称" htmlFor="mn-name" optional>
        <Input
          id="mn-name"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="不填按地址命名"
        />
      </FormField>
      <FormField label="地址" htmlFor="mn-server" required>
        <Input
          id="mn-server"
          value={value.server}
          onChange={(e) => set({ server: e.target.value })}
          placeholder="IP 或域名"
        />
      </FormField>
      <FormField label="端口" htmlFor="mn-port" required>
        <NumberInput
          id="mn-port"
          value={value.port || null}
          onChange={(port) => set({ port: port ?? 0 })}
          min={1}
          max={65535}
        />
      </FormField>
      <FormField label="用户名" htmlFor="mn-user" optional>
        <Input
          id="mn-user"
          value={value.username}
          onChange={(e) => set({ username: e.target.value })}
          autoComplete="off"
        />
      </FormField>
      <FormField label="密码" htmlFor="mn-pass" optional>
        <PasswordInput
          id="mn-pass"
          value={value.password}
          onChange={(e) => set({ password: e.target.value })}
          autoComplete="new-password"
        />
      </FormField>
    </FormSection>
  );
}

export function NodeImportDialog({ onClose }: { onClose: () => void }) {
  const { say } = useFeedback();
  const [tab, setTab] = useState<"link" | "manual">("link");
  const [links, setLinks] = useState("");
  const [manual, setManual] = useState<ManualNode>(EMPTY);
  const dirty = tab === "link" ? links.trim() !== "" : manual.server.trim() !== "";

  const submit = async () => {
    if (tab === "link") {
      if (!links.trim()) throw new Error("请先粘贴至少一个分享链接");
      say(await addNodes(links));
      return;
    }
    const err = await addManualNode(manual);
    if (err) throw new Error(err);
    say("已添加 1 个节点");
  };

  return (
    <FormDialog
      open
      title="添加节点"
      description="粘贴分享链接导入，或手动填写 SOCKS5 / HTTP 代理（没有分享链接时用）。"
      submitLabel={tab === "link" ? "解析并添加" : "添加"}
      dirty={dirty}
      onClose={onClose}
      onSubmit={submit}
    >
      <Tabs
        label="添加方式"
        value={tab}
        onValueChange={(v) => setTab(v === "manual" ? "manual" : "link")}
        items={[
          { value: "link", label: "链接导入" },
          { value: "manual", label: "手动添加" },
        ]}
      >
        {tab === "link" ? (
          <FormField label="分享链接" htmlFor="node-links" hint="支持一次导入多个节点，重复节点会自动跳过。">
            <Textarea
              id="node-links"
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              minRows={6}
              placeholder={
                "每行粘贴一个链接\nvless://  vmess://  trojan://  ss://\nsocks://  http://  hy2://  tuic://  wireguard://\n也支持 IP:端口:用户名:密码（按 socks5），或整份 WireGuard .conf"
              }
            />
          </FormField>
        ) : (
          <ManualFields value={manual} set={(p) => setManual((m) => ({ ...m, ...p }))} />
        )}
      </Tabs>
    </FormDialog>
  );
}
