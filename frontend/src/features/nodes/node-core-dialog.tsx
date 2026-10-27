// 节点内核：自动 / sing-box / Xray。只能用 Xray 的节点禁用 sing-box，Xray 不支持的协议禁用 Xray，并在下方说明原因。
import {
  Button,
  Dialog,
  DialogFooter,
  FormField,
  Note,
  SegmentedControl,
  type SegmentedOption,
  Tag,
} from "@ankotti/admin-ui";
import { useState } from "react";
import type { Node, NodeCore } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { setNodeCore } from "../../state/nodes";

type Choice = "auto" | "sing-box" | "xray";

/** 实际内核的显示名。 */
export function coreLabel(n: Node): string {
  return n.coreInfo?.effective === "xray" ? "Xray" : "sing-box";
}

function toChoice(core?: string): Choice {
  return core === "sing-box" || core === "xray" ? core : "auto";
}

function options(n: Node): SegmentedOption<Choice>[] {
  const info = n.coreInfo;
  return [
    { value: "auto", label: "自动" },
    { value: "sing-box", label: "sing-box", disabled: info?.xrayOnly === true },
    { value: "xray", label: "Xray", disabled: info?.xraySupported !== true },
  ];
}

function hint(n: Node): string {
  if (n.coreInfo?.xrayOnly) return "该节点只能用 Xray（XHTTP / mKCP / VLESS encryption），sing-box 跑不了。";
  if (!n.coreInfo?.xraySupported) return "Xray 不支持该协议，只能用 sing-box。";
  return "自动 = 优先 sing-box。某个节点在本软件连不上、但在 v2rayN 里能用时，可以试试改成 Xray。";
}

export function NodeCoreDialog({ node, onClose }: { node: Node; onClose: () => void }) {
  const { say } = useFeedback();
  const [choice, setChoice] = useState<Choice>(toChoice(node.core));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const core: NodeCore = choice === "auto" ? "" : choice;
    const err = await setNodeCore(node.id, core);
    setSaving(false);
    if (err) {
      say(`切换内核失败：${err}`, "error");
      return;
    }
    say(`「${node.name}」内核已设为${choice === "auto" ? "自动" : choice === "xray" ? " Xray" : " sing-box"}`);
    onClose();
  };
  return (
    <Dialog
      open
      size="sm"
      title="节点内核"
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
      <FormField label="内核" htmlFor="node-core" hint={hint(node)}>
        <SegmentedControl<Choice> label="节点内核" value={choice} options={options(node)} onValueChange={setChoice} />
      </FormField>
      <Note as="p">
        当前实际内核：<Tag size="sm">{coreLabel(node)}</Tag>。节点正在使用时，保存后会自动重启代理。
      </Note>
    </Dialog>
  );
}
