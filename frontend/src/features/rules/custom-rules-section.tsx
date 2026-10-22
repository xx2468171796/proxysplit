// 自定义规则：本地草稿编辑，「保存并应用」后整表推给 Go（运行中会重启内核生效）。
import { Panel, SaveBar } from "@ankotti/admin-ui";
import { useState } from "react";
import type { RouteRule } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { routing, saveCustomRules } from "../../state/routing";
import { isRunning, runtime } from "../../state/runtime";
import { CustomRulesGuide } from "./custom-rules-guide";
import { RouteRuleEditor } from "./route-rule-editor";

const same = (a: RouteRule | undefined, b: RouteRule | undefined) =>
  !!a && !!b && a.type === b.type && a.value === b.value && a.action === b.action;

/** 草稿和已保存相比改了几处（逐行比，多出 / 少了的行各算一处）。 */
function changeCount(saved: RouteRule[], draft: RouteRule[]): number {
  let n = Math.abs(saved.length - draft.length);
  for (let i = 0; i < Math.min(saved.length, draft.length); i++) if (!same(saved[i], draft[i])) n++;
  return n;
}

export function CustomRulesSection() {
  const { say } = useFeedback();
  const saved = useStore(routing, (s) => s.customRules);
  const running = useStore(runtime, (s) => isRunning(s.status));
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved);
  // 已保存的列表刷新了（进页面 / 保存后）：草稿跟着重置。
  if (base !== saved) {
    setBase(saved);
    setDraft(saved);
  }
  const changes = changeCount(saved, draft);

  const save = async () => {
    const err = await saveCustomRules(draft);
    if (err) throw new Error(`保存失败：${err}`);
    say(running ? "已保存并重启生效" : "已保存（启动后生效）");
  };

  return (
    <Panel
      title="自定义规则"
      description="你自己填的规则，盖过规则库的国内外分流，顶栏选「按规则」时生效。应用单独设的「不走代理 / 禁止联网」优先于它；「只代理列出的」时，「走代理」只作用于列出的应用。"
    >
      <div className="ps-stack">
        <CustomRulesGuide />
        <RouteRuleEditor
          variant="full"
          idBase="custom-rule"
          rules={draft}
          onChange={setDraft}
          defaultAction="proxy"
          addLabel="加一条"
          emptyText="还没有自定义规则。点「加一条」添加，比如「github.com → 走代理」、「某国内网站 → 直连」、「广告域名 → 拦截」，填完点「保存并应用」。"
        />
        <SaveBar
          placement="footer"
          count={changes}
          saveLabel="保存并应用"
          discardLabel="撤销改动"
          onDiscard={() => setDraft(saved)}
          onSave={save}
        />
      </div>
    </Panel>
  );
}
