// 应用规则当前是否生效：整机全局 / 代理策略非「规则」时规则被覆盖；否则说明当前分流模式。
import { Button, InlineAlert } from "@ankotti/admin-ui";
import { navigate } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { data, setClashMode, setRuleMode } from "../../state/data";

export function AppsAlerts() {
  const { say } = useFeedback();
  const tunMode = useStore(data, (s) => s.settings.tunMode);
  const clashMode = useStore(data, (s) => s.clashMode);
  const ruleMode = useStore(data, (s) => s.ruleMode);

  if (tunMode) {
    return (
      <InlineAlert
        tone="warning"
        title="当前是「整机全局」，下面的应用规则暂不生效"
        action={
          <Button size="sm" variant="outline" onClick={() => navigate("settings")}>
            去设置
          </Button>
        }
      >
        所有程序都走代理。到设置把「代理范围」切回「应用分流」即可启用。
      </InlineAlert>
    );
  }
  if (clashMode !== "rule") {
    return (
      <InlineAlert
        tone="warning"
        title={`顶栏选了「${clashMode === "global" ? "全部代理" : "全部直连"}」，下面的规则暂不生效`}
        action={
          <Button size="sm" variant="outline" onClick={() => void setClashMode("rule").then(say)}>
            切回按规则
          </Button>
        }
      >
        {clashMode === "global"
          ? "除设为「不走代理」「禁止联网」的应用外，所有程序都走代理。"
          : "除设为「禁止联网」的应用外，所有程序都直连。"}
        切回「按规则」即可按应用分流。
      </InlineAlert>
    );
  }
  if (ruleMode === "whitelist") {
    return (
      <InlineAlert density="compact" title="只代理列出的">
        只有下面已启用的应用按各自的方式和节点走代理，其余程序一律直连。
      </InlineAlert>
    );
  }
  return (
    <InlineAlert
      density="compact"
      title="默认全代理"
      action={
        <Button size="sm" variant="ghost" onClick={() => void setRuleMode("whitelist").then(say)}>
          切到「只代理列出的」
        </Button>
      }
    >
      没列出的程序按上方选的线路走（默认「智能分流」：国内直连、国外走代理）；列出的应用按各自的方式和节点走。
    </InlineAlert>
  );
}
