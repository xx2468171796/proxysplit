// 分流规则（T05 分区合并）：规则库 / 自定义规则 / 线路 三个分区；进页面刷新规则库和自定义规则。
import { TabbedPage } from "@ankotti/admin-ui";
import { useEffect, useState } from "react";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { refreshCustomRules, refreshRuleSets, routing } from "../../state/routing";
import { CustomRulesSection } from "./custom-rules-section";
import { LinesSection } from "./lines-section";
import { RuleSetsSection } from "./rule-sets-section";
import "./rules.css";

export function RulesPage() {
  const [tab, setTab] = useState("sets");
  const setCount = useStore(routing, (s) => s.ruleSets.length);
  const customCount = useStore(routing, (s) => s.customRules.length);
  const lineCount = useStore(data, (s) => s.lines.filter((l) => !l.builtin).length);
  const missing = useStore(routing, (s) => s.ruleSets.some((r) => r.enabled && !r.present));
  useEffect(() => {
    void refreshRuleSets();
    void refreshCustomRules();
  }, []);

  return (
    <TabbedPage
      title="分流规则"
      description="规则库决定哪些网站 / IP 走代理、哪些直连；自定义规则盖过规则库；线路 = 出口 + 分流策略，给应用选用。"
      value={tab}
      onValueChange={setTab}
      sections={[
        { id: "sets", label: "规则库", count: setCount, countTone: missing ? "attention" : "neutral" },
        { id: "custom", label: "自定义规则", count: customCount },
        { id: "lines", label: "线路", count: lineCount },
      ]}
      render={(id) => {
        if (id === "custom") return <CustomRulesSection />;
        if (id === "lines") return <LinesSection />;
        return <RuleSetsSection />;
      }}
    />
  );
}
