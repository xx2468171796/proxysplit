// 前置代理：选一个能连上的节点，本节点经由它连过去（例如国内直连会被拦的 socks5 节点）。
import { Button, Choice, Dialog, DialogFooter, FormField, Note } from "@ankotti/admin-ui";
import { useMemo, useState } from "react";
import type { Node } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { setNodeVia } from "../../state/nodes";

const NONE = "__none__";

/** 能当前置的节点：不是自己、不是官方线路、自己没再设前置（只支持一层）。 */
export function frontCandidates(self: Node, nodes: Node[]): Node[] {
  return nodes.filter((n) => n.id !== self.id && !n.official && !n.via);
}

export function NodeViaDialog({ node, onClose }: { node: Node; onClose: () => void }) {
  const { say } = useFeedback();
  const nodes = useStore(data, (s) => s.nodes);
  const [via, setVia] = useState(node.via || NONE);
  const [saving, setSaving] = useState(false);
  const options = useMemo(
    () => [
      { value: NONE, label: "不使用（直接连）" },
      ...frontCandidates(node, nodes).map((n) => ({ value: n.id, label: n.name, keywords: `${n.server} ${n.type}` })),
    ],
    [node, nodes],
  );
  const save = async () => {
    setSaving(true);
    const err = await setNodeVia(node.id, via === NONE ? "" : via);
    setSaving(false);
    if (err) {
      say(`设置前置代理失败：${err}`, "error");
      return;
    }
    say(via === NONE ? `「${node.name}」已改为直接连接` : `「${node.name}」将经由前置节点连接`);
    onClose();
  };
  return (
    <Dialog
      open
      size="sm"
      title="前置代理"
      description={node.name}
      onClose={onClose}
      footer={
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button loading={saving} loadingText="保存中…" onClick={() => void save()}>
            保存
          </Button>
        </DialogFooter>
      }
    >
      <FormField
        label="经由节点"
        htmlFor="node-via"
        hint="先连上这个节点，再通过它连到本节点。只支持一层；POWER云 官方线路不能当前置。"
      >
        <Choice label="经由节点" options={options} value={via} onChange={setVia} />
      </FormField>
      <Note as="p">
        适合国内直接连不上的节点（例如明文 socks5
        被拦）。设置后测延迟、测速也走同一条链路；节点正在使用时会自动重启代理。
      </Note>
    </Dialog>
  );
}
