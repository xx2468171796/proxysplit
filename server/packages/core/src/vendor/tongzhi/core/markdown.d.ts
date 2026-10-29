export type Inline = {
    t: "text";
    v: string;
} | {
    t: "strong";
    c: Inline[];
} | {
    t: "em";
    c: Inline[];
} | {
    t: "code";
    v: string;
} | {
    t: "link";
    href: string;
    c: Inline[];
} | {
    t: "br";
};
export type Block = {
    t: "h";
    level: 1 | 2 | 3;
    c: Inline[];
} | {
    t: "p";
    c: Inline[];
} | {
    t: "ul";
    items: Inline[][];
} | {
    t: "ol";
    items: Inline[][];
} | {
    t: "quote";
    c: Inline[];
} | {
    t: "img";
    src: string;
    alt: string;
} | {
    t: "hr";
};
export declare function parseInline(text: string): Inline[];
export declare function parseMarkdown(src: string): Block[];
/** 纯文本摘要(铃铛列表 / 跑马灯 / 预览用) */
export declare function plainText(src: string, max?: number): string;