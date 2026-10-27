// 规则：规则库、自定义域名规则、线路都在「分流规则」页，应用名单在「应用分流」页；这里只放入口，避免两处各改一份。
import { FormSection, Panel } from "@ankotti/admin-ui";
import { navigate, openSettings } from "../../app/nav";
import { useStore } from "../../shared/store";
import { data } from "../../state/data";
import { LinkRow } from "./link-row";

export function RulesLinkSection() {
  const ruleCount = useStore(data, (s) => s.rules.length);
  return (
    <Panel className="qd-pane" title="规则" description="规则只在对应页面里改；这里是入口。">
      <FormSection>
        <LinkRow
          id="rules-page"
          label="规则库与自定义规则"
          hint="geoip / geosite 规则库开关与更新、自定义域名 / IP 规则、自定义线路"
          actions={[{ label: "打开分流规则", onClick: () => navigate("rules") }]}
        />
        <LinkRow
          id="rules-apps"
          label={`应用名单（${ruleCount} 条）`}
          hint="哪些程序走代理、直连或拦截"
          actions={[{ label: "打开应用分流", onClick: () => navigate("apps") }]}
        />
        <LinkRow
          id="rules-reset"
          label="恢复默认"
          hint="分流设置恢复默认、应用名单清空（自动备份，可撤销）"
          actions={[{ label: "清除与重置", onClick: () => openSettings("reset") }]}
        />
      </FormSection>
    </Panel>
  );
}
