/**
 * 通知正文用的 Markdown 子集 → 结构化块(纯数据,零依赖;React 层再把块变成节点)。
 * **永远不产出 HTML 字符串**,所以不存在 innerHTML 注入面;链接/图片地址过一遍 isSafeUrl 白名单。
 *
 * 支持:# / ## / ### 标题、段落(单换行 = 换行)、- 无序列表、1. 有序列表、> 引用、
 *      **粗体**、*斜体*、`行内代码`、[文字](url)、![alt](url)、--- 分隔线。
 * 不支持(刻意):HTML 标签、表格、嵌套列表 —— 通知不是文档。
 */
import { isSafeUrl } from "./logic.js";
const INLINE_RE = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/;
export function parseInline(text) {
    const out = [];
    let rest = text;
    while (rest.length) {
        const m = INLINE_RE.exec(rest);
        if (!m) {
            pushText(out, rest);
            break;
        }
        if (m.index > 0)
            pushText(out, rest.slice(0, m.index));
        if (m[1])
            out.push({ t: "strong", c: parseInline(m[2] ?? "") });
        else if (m[3])
            out.push({ t: "em", c: parseInline(m[4] ?? "") });
        else if (m[5])
            out.push({ t: "code", v: m[6] ?? "" });
        else if (m[7]) {
            const href = m[9] ?? "";
            if (isSafeUrl(href))
                out.push({ t: "link", href, c: parseInline(m[8] ?? "") });
            else
                pushText(out, m[8] ?? "");
        }
        rest = rest.slice(m.index + m[0].length);
    }
    return out;
}
function pushText(out, v) {
    const parts = v.split("\n");
    parts.forEach((p, i) => {
        if (p)
            out.push({ t: "text", v: p });
        if (i < parts.length - 1)
            out.push({ t: "br" });
    });
}
export function parseMarkdown(src) {
    const lines = (src ?? "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let para = [];
    let list = null;
    const flushPara = () => {
        if (para.length) {
            blocks.push({ t: "p", c: parseInline(para.join("\n")) });
            para = [];
        }
    };
    const flushList = () => { if (list) {
        blocks.push(list);
        list = null;
    } };
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) {
            flushPara();
            flushList();
            continue;
        }
        const h = /^(#{1,3})\s+(.+)$/.exec(line);
        if (h) {
            flushPara();
            flushList();
            blocks.push({ t: "h", level: (h[1] ?? "").length, c: parseInline(h[2] ?? "") });
            continue;
        }
        if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
            flushPara();
            flushList();
            blocks.push({ t: "hr" });
            continue;
        }
        const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line.trim());
        if (img) {
            flushPara();
            flushList();
            if (isSafeUrl(img[2] ?? ""))
                blocks.push({ t: "img", src: img[2] ?? "", alt: img[1] ?? "" });
            continue;
        }
        const q = /^>\s?(.*)$/.exec(line);
        if (q) {
            flushPara();
            flushList();
            blocks.push({ t: "quote", c: parseInline(q[1] ?? "") });
            continue;
        }
        const ul = /^[-*]\s+(.+)$/.exec(line);
        const ol = /^\d+[.)]\s+(.+)$/.exec(line);
        const li = ul ?? ol;
        if (li) {
            flushPara();
            const t = ul ? "ul" : "ol";
            if (!list || list.t !== t) {
                flushList();
                list = { t, items: [] };
            }
            list.items.push(parseInline(li[1] ?? ""));
            continue;
        }
        flushList();
        para.push(line);
    }
    flushPara();
    flushList();
    return blocks;
}
/** 纯文本摘要(铃铛列表 / 跑马灯 / 预览用) */
export function plainText(src, max = 140) {
    const flat = (c) => c.map((i) => (i.t === "text" ? i.v : i.t === "br" ? " " : i.t === "code" ? i.v : "c" in i ? flat(i.c) : "")).join("");
    const s = parseMarkdown(src)
        .map((b) => (b.t === "img" ? b.alt : b.t === "hr" ? "" : "items" in b ? b.items.map(flat).join(" ") : flat(b.c)))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
