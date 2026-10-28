// 前置代理（链式代理）：默认关闭。打开后先连「前置节点」，再经它连到本节点，网站看到的仍是本节点的 IP。
import { Button, Choice, Dialog, DialogFooter, FormField, Note, Switch } from "@ankotti/admin-ui";
import { useMemo, useState } from "react";
import type { Node } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { setNodeVia } from "../../state/nodes";
import { ViaChain } from "./via-chain";

/** 能当前置的节点：不是自己、不是官方线路、自己没再设前置（只支持一层）。 */
export function frontCandidates(self: Node, nodes: Node[]): Node[] {
  return nodes.filter((n) => n.id !== self.id && !n.official && !n.via);
}

export function NodeViaDialog({ node, onClose }: { node: Node; onClose: () => void }) {
  const { say } = useFeedback();
  const nodes = useStore(data, (s) => s.nodes);
  const [on, setOn] = useState(!!node.via);
  const [via, setVia] = useState(node.via ?? "");
  const [saving, setSaving] = useState(false);
  const candidates = useMemo(() => frontCandidates(node, nodes), [node, nodes]);
  const options = useMemo(
    () => candidates.map((n) => ({ value: n.id, label: n.name, keywords: `${n.server} ${n.type}` })),
    [candidates],
  );
  const frontName = on ? nodes.find((n) => n.id === via)?.name : undefined;
  const save = async () => {
    const target = on ? via : "";
    setSaving(true);
    const err = await setNodeVia(node.id, target);
    setSaving(false);
    if (err) {
      say(`设置前置代理失败：${err}`, "error");
      return;
    }
    say(target ? `「${node.name}」已改为经「${frontName}」连接` : `「${node.name}」已关闭前置代理，直接连接`);
    onClose();
  };
  return (
    <Dialog
      open
      size="md"
      title="前置代理"
      description={node.name}
      onClose={onClose}
      footer={
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button loading={saving} loadingText="保存中…" disabled={on && !via} onClick={() => void save()}>
            保存
          </Button>
        </DialogFooter>
      }
    >
      <Note as="p">
        <b>这是什么：</b>正常情况下本机直接连到节点。打开前置代理后，会先连上另一个「前置节点」，再通过它连到这个节点。
        网站看到的出口 IP 仍然是这个节点的。
        <br />
        <b>什么时候用：</b>这个节点在国内直接连不上（例如明文 socks5 被拦），或者它只允许某个 IP
        来连。用不到就保持关闭。
      </Note>
      <ViaChain target={node.name} front={frontName} />
      <FormField label="启用前置代理" htmlFor="node-via-on" hint="默认关闭；关闭 = 本机直接连这个节点">
        <Switch id="node-via-on" checked={on} onCheckedChange={setOn} />
      </FormField>
      {on ? (
        <FormField
          label="前置节点"
          htmlFor="node-via"
          hint={
            candidates.length
              ? "选一个本机能直接连上的节点。只支持一层；POWER云 官方线路和已设了前置的节点不能当前置。"
              : "没有可用的前置节点：先导入一个本机能直接连上的普通节点。"
          }
        >
          <Choice label="前置节点" placeholder="选择前置节点" options={options} value={via} onChange={setVia} />
        </FormField>
      ) : null}
      <Note as="p">设置后测延迟、测速也走同一条链路；节点正在使用时会自动重启代理（几秒）。</Note>
    </Dialog>
  );
}
