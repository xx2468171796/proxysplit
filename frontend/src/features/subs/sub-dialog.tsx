// 添加 / 编辑订阅。编辑保存后 Go 端会立即重新拉取一次，所以按钮叫「保存并更新」。
import { FormDialog, FormField, FormSection, Input, Switch } from "@ankotti/admin-ui";
import { useState } from "react";
import type { Sub } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { addSub, editSub } from "../../state/subs";

export function SubDialog({ sub, onClose }: { sub?: Sub; onClose: () => void }) {
  const { say } = useFeedback();
  const [name, setName] = useState(sub?.name ?? "");
  const [url, setUrl] = useState(sub?.url ?? "");
  const [auto, setAuto] = useState(false);
  const dirty = name !== (sub?.name ?? "") || url !== (sub?.url ?? "");

  const submit = async () => {
    const err = sub ? await editSub(sub.id, name, url) : await addSub(name, url, auto);
    if (err) throw new Error(err);
    say(sub ? "已保存并更新订阅" : "订阅已添加");
  };

  return (
    <FormDialog
      open
      title={sub ? "编辑订阅" : "添加订阅"}
      description={sub ? "改名或改地址后会立即重新拉取节点。" : "粘贴机场给的订阅链接，添加后立即拉取节点。"}
      submitLabel={sub ? "保存并更新" : "添加"}
      dirty={dirty}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormSection>
        <FormField label="订阅名称" htmlFor="sub-name" required full>
          <Input id="sub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：机场 A" />
        </FormField>
        <FormField label="订阅地址" htmlFor="sub-url" required full>
          <Input id="sub-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" mono />
        </FormField>
        {!sub && (
          <FormField label="自动更新" htmlFor="sub-auto" hint="开启后定期自动拉取最新节点。">
            <Switch id="sub-auto" checked={auto} onCheckedChange={setAuto} />
          </FormField>
        )}
      </FormSection>
    </FormDialog>
  );
}
