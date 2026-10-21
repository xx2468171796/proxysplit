// 目标条件：只对指定域名后缀 / IP 段 / 端口生效；三项全空 = 整个应用。
import { FormDialog, FormField, Input } from "@ankotti/admin-ui";
import { useState } from "react";
import type { AppRule } from "../../api/types";
import { parseList } from "../../shared/format";
import { useStore } from "../../shared/store";
import { ruleName, updateRule } from "../../state/app-rules";
import { data } from "../../state/data";
import { lineLabel } from "../../state/routing";

type Props = { rule: AppRule; onClose: () => void };

const join = (list: string[] | undefined) => (list ?? []).join(", ");

export function ScopeDialog({ rule, onClose }: Props) {
  const lines = useStore(data, (s) => s.lines);
  const [domains, setDomains] = useState(join(rule.domains));
  const [ips, setIps] = useState(join(rule.ips));
  const [ports, setPorts] = useState(join(rule.ports));
  const dirty = domains !== join(rule.domains) || ips !== join(rule.ips) || ports !== join(rule.ports);
  const name = ruleName(rule);

  const submit = async () => {
    const err = await updateRule(rule.match, {
      domains: parseList(domains),
      ips: parseList(ips),
      ports: parseList(ports),
    });
    if (err) throw new Error(`保存失败：${err}`);
  };

  return (
    <FormDialog
      open
      title={`目标条件 · ${name}`}
      description={`填了条件后，${name} 只有访问这些目标的流量才按「${lineLabel(rule.line, lines)}」走，其余流量按默认；三项全空 = 整个应用。多个用逗号分隔。`}
      dirty={dirty}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormField label="域名后缀" htmlFor="scope-domains" optional full>
        <Input
          id="scope-domains"
          value={domains}
          placeholder="如 google.com, openai.com"
          onChange={(e) => setDomains(e.target.value)}
        />
      </FormField>
      <FormField label="IP / 段" htmlFor="scope-ips" optional full>
        <Input
          id="scope-ips"
          value={ips}
          placeholder="如 1.1.1.1/32, 10.0.0.0/8"
          onChange={(e) => setIps(e.target.value)}
        />
      </FormField>
      <FormField label="端口" htmlFor="scope-ports" optional full>
        <Input
          id="scope-ports"
          value={ports}
          placeholder="如 443, 8000-9000"
          onChange={(e) => setPorts(e.target.value)}
        />
      </FormField>
    </FormDialog>
  );
}
