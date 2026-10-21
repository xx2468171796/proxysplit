// 导入规则：先读剪贴板，读不到就弹框粘贴 → 预检 → 确认（原子替换）→ 导入。
import { ConfirmDialog, FormDialog, FormField, Textarea } from "@ankotti/admin-ui";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { applyImport, previewImport } from "../../state/app-rules";

type Pending = { json: string; summary: string };

export function useImportFlow() {
  const { say } = useFeedback();
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  /** 预检通过就进入确认；失败返回错误文本。 */
  const check = async (json: string): Promise<string> => {
    const p = await previewImport(json);
    if (p.err) return p.err;
    setPending({ json, summary: p.summary ?? "" });
    return "";
  };

  const start = async () => {
    let clip = "";
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      clip = "";
    }
    if (!clip.trim()) {
      setText("");
      setPasting(true);
      return;
    }
    say(await check(clip));
  };

  const dialogs = (
    <>
      {pasting ? (
        <FormDialog
          open
          title="导入规则"
          description="剪贴板里没有内容，把导出的规则 JSON 粘贴到下面。"
          submitLabel="下一步"
          dirty={!!text.trim()}
          onClose={() => setPasting(false)}
          onSubmit={async () => {
            if (!text.trim()) throw new Error("请粘贴规则 JSON");
            const err = await check(text);
            if (err) throw new Error(err);
          }}
        >
          <FormField label="规则 JSON" htmlFor="import-json" full>
            <Textarea
              id="import-json"
              className="ps-mono"
              minRows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </FormField>
        </FormDialog>
      ) : null}
      <ConfirmDialog
        open={!!pending}
        title="规则导入预检通过"
        description={pending?.summary}
        impact="导入会原子替换对应规则，是否继续？"
        tone="warning"
        confirmLabel="导入"
        onConfirm={async () => {
          if (!pending) return;
          const err = await applyImport(pending.json);
          if (err) throw new Error(err);
          say("导入成功");
        }}
        onClose={() => setPending(null)}
      />
    </>
  );
  return { start: () => void start(), dialogs };
}
