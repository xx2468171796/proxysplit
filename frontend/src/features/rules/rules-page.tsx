// 分流规则（T05 分区合并）：规则库 / 自定义规则 / 线路 三个分区；进页面刷新规则库和自定义规则。
// 页头两个入口来自原设置「规则」一节（业主 2026-10-28 合并同类项）：应用名单在「分流」页，恢复默认在「清除与重置」。
import { Button, TabbedPage } from "@ankotti/admin-ui";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate, openSettings } from "../../app/nav";
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
  const appRuleCount = useStore(data, (s) => s.rules.length);
  const missing = useStore(routing, (s) => s.ruleSets.some((r) => r.enabled && !r.present));
  useEffect(() => {
    void refreshRuleSets();
    void refreshCustomRules();
  }, []);

  return (
    <TabbedPage
      title="分流规则"
      description="规则库决定哪些网站 / IP 走代理、哪些直连；自定义规则盖过规则库；线路 = 出口 + 分流策略，给应用选用。"
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => navigate("apps")}>
            <ArrowUpRight />
            应用名单（{appRuleCount} 条）
          </Button>
          <Button size="sm" variant="outline" onClick={() => openSettings("reset")}>
            <ArrowUpRight />
            清除与重置
          </Button>
        </>
      }
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
