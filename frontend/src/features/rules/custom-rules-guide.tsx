// 「怎么填？」：四种匹配方式的写法对照 + 注意事项（折叠，点开看）。
import { CompactTable } from "@ankotti/admin-ui";
import { Accordion } from "@ankotti/admin-ui/display";
import { CircleHelp } from "lucide-react";

type GuideRow = { id: string; type: string; fill: string; hits: string; misses: string };

const ROWS: GuideRow[] = [
  {
    id: "suffix",
    type: "域名后缀（推荐）",
    fill: "zygskins.cn",
    hits: "zygskins.cn、www.zygskins.cn、a.b.zygskins.cn",
    misses: "myzygskins.cn",
  },
  {
    id: "domain",
    type: "完整域名",
    fill: "www.zygskins.cn",
    hits: "只有 www.zygskins.cn 这一个",
    misses: "zygskins.cn、api.zygskins.cn",
  },
  {
    id: "keyword",
    type: "关键字",
    fill: "zygskins",
    hits: "域名里含这个词的都算，如 zygskins.com、cdn-zygskins.net",
    misses: "—（范围大，慎用）",
  },
  {
    id: "ip",
    type: "IP 段",
    fill: "1.1.1.1 或 10.0.0.0/8",
    hits: "这个 IP / 这一段 IP",
    misses: "域名（填域名请选上面三种）",
  },
];

// GridField 没从根导出：从 CompactTable 的参数类型取。
type GuideFields = Parameters<typeof CompactTable<GuideRow>>[0]["fields"];

const FIELDS: GuideFields = [
  { key: "type", title: "匹配方式", type: "text", primary: true, width: 150, value: (r) => r.type },
  { key: "fill", title: "填什么", type: "custom", width: 180, render: (r) => <code>{r.fill}</code> },
  { key: "hits", title: "能匹配", type: "longText", value: (r) => r.hits },
  { key: "misses", title: "匹配不到", type: "text", width: 220, value: (r) => r.misses },
];

function GuideBody() {
  return (
    <div className="ps-guide">
      <CompactTable
        caption="匹配方式写法"
        rows={ROWS}
        getRowId={(r) => r.id}
        fields={FIELDS}
        expandRecord={false}
        rowHeight="medium"
      />
      <ul className="ps-guide-notes">
        <li>
          只填域名本身：不要 <code>https://</code>、路径、端口。直接粘贴网址也行，保存时会自动只留域名（
          <code>https://www.x.com/a</code> → <code>www.x.com</code>）。
        </li>
        <li>
          <code>*.x.com</code> 或 <code>.x.com</code> 会自动改成「域名后缀 x.com」；通配符只能写在开头。
        </li>
        <li>想管一个网站的所有子域名，就选「域名后缀」填主域名；「完整域名」只管填的那一个。</li>
        <li>
          规则从上往下第一条匹配的生效；「代理策略」为「规则」时才生效；「只代理列出的」模式下，「走代理」只对列出的应用起作用，没列出的应用仍直连。
        </li>
        <li>国内服务器上的网站（比如我们自己的 *.zygskins.cn）走境外节点反而可能打不开，一般设「直连」即可。</li>
      </ul>
    </div>
  );
}

export function CustomRulesGuide() {
  return (
    <Accordion
      flush
      label="自定义规则写法"
      items={[{ key: "guide", icon: <CircleHelp />, title: "怎么填？（点开看写法）", content: <GuideBody /> }]}
    />
  );
}
