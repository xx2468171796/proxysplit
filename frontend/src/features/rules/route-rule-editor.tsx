// 可编辑的路由规则列表（匹配方式 / 内容 / 动作）：自定义规则和自定义线路共用。
import { Button, Choice, IconButton, Input, Note, type SelectItem } from "@ankotti/admin-ui";
import { Plus, Trash2 } from "lucide-react";
import type { RouteRule } from "../../api/types";

const TYPES_FULL: SelectItem[] = [
  { value: "suffix", label: "域名后缀（含子域名）" },
  { value: "domain", label: "完整域名（仅这一个）" },
  { value: "keyword", label: "关键字" },
  { value: "ip", label: "IP 段（CIDR）" },
];
const TYPES_SHORT: SelectItem[] = [
  { value: "suffix", label: "域名后缀" },
  { value: "domain", label: "完整域名" },
  { value: "keyword", label: "关键字" },
  { value: "ip", label: "IP 段（CIDR）" },
];
const ACTIONS: SelectItem[] = [
  { value: "proxy", label: "走代理" },
  { value: "direct", label: "直连" },
  { value: "block", label: "拦截" },
];

const PLACEHOLDER_FULL: Record<string, string> = {
  ip: "如 1.1.1.1 或 10.0.0.0/8",
  keyword: "如 zygskins（域名含这个词即匹配）",
  domain: "如 www.zygskins.cn（只匹配这一个）",
  suffix: "如 zygskins.cn（含所有子域名）",
};

function placeholder(type: string, full: boolean): string {
  if (full) return PLACEHOLDER_FULL[type] ?? PLACEHOLDER_FULL.suffix ?? "";
  return type === "ip" ? "如 10.0.0.0/8" : "如 google.com";
}

type Props = {
  rules: RouteRule[];
  onChange: (rules: RouteRule[]) => void;
  /** full = 自定义规则页（长说明）；short = 线路弹框 */
  variant: "full" | "short";
  idBase: string;
  emptyText: string;
  addLabel: string;
  /** 新加一条的默认动作 */
  defaultAction: string;
};

export function RouteRuleEditor({ rules, onChange, variant, idBase, emptyText, addLabel, defaultAction }: Props) {
  const full = variant === "full";
  const patch = (i: number, p: Partial<RouteRule>) => onChange(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const add = () => onChange([...rules, { type: "suffix", value: "", action: defaultAction }]);
  return (
    <div className="ps-rr" data-variant={variant}>
      {rules.length > 0 ? (
        <div className="ps-rr-row ps-rr-head" aria-hidden="true">
          <span>匹配方式</span>
          <span>内容</span>
          <span>动作</span>
          <span />
        </div>
      ) : (
        <Note as="div" className="ps-rr-empty">
          {emptyText}
        </Note>
      )}
      {rules.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 规则没有 id，行内容随时在改
        <div className="ps-rr-row" key={i}>
          <Choice
            size="sm"
            label={`第 ${i + 1} 条的匹配方式`}
            value={r.type}
            options={full ? TYPES_FULL : TYPES_SHORT}
            onChange={(type) => patch(i, { type })}
          />
          <Input
            size="sm"
            id={`${idBase}-${i}`}
            aria-label={`第 ${i + 1} 条的内容`}
            value={r.value}
            placeholder={placeholder(r.type, full)}
            onChange={(e) => patch(i, { value: e.target.value })}
          />
          <Choice
            size="sm"
            label={`第 ${i + 1} 条的动作`}
            value={r.action}
            options={ACTIONS}
            onChange={(action) => patch(i, { action })}
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="删除此规则"
            icon={<Trash2 />}
            onClick={() => onChange(rules.filter((_, k) => k !== i))}
          />
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
