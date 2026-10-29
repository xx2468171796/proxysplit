export const BUILTIN_TEMPLATES = [
    {
        key: "maintenance",
        name: "停机维护公告",
        description: "维护前 6 小时挂横幅 + 跑马灯,维护当天每日弹一次窗",
        vars: ["date", "start", "end", "reason"],
        input: {
            kind: "maintenance",
            severity: "high",
            surfaces: ["modal", "marquee", "banner", "inbox"],
            title: "{{date}} {{start}}–{{end}} 停机维护",
            body: "为了{{reason}},服务器将于 **{{date}} {{start}}** 至 **{{end}}** 停机维护。\n\n维护期间无法登录与开箱,请提前安排。给您带来的不便敬请谅解。",
            frequency: "daily",
            maxPopups: 0,
            pinned: true,
        },
    },
    {
        key: "event",
        name: "活动上线",
        description: "活动期内弹一次窗 + 收件箱常驻,带「去看看」按钮",
        vars: ["name", "until", "url"],
        input: {
            kind: "event",
            severity: "normal",
            surfaces: ["modal", "inbox", "marquee"],
            title: "「{{name}}」活动上线",
            body: "活动已开启,截止 **{{until}}**。点击下方按钮查看详情。",
            actions: [{ label: "去看看", url: "{{url}}", style: "primary" }],
            frequency: "once",
            maxPopups: 1,
        },
    },
    {
        key: "compensation",
        name: "补偿到账",
        description: "定向发给受影响玩家,收件箱 + 即时提示",
        vars: ["what", "amount"],
        input: {
            kind: "reward",
            severity: "normal",
            surfaces: ["inbox", "toast"],
            title: "补偿已到账",
            body: "因{{what}},我们已向您的账户发放 **{{amount}}**,请查收。",
        },
    },
    {
        key: "warning",
        name: "风险提示",
        description: "横幅常驻 + 收件箱,不弹窗",
        vars: ["text"],
        input: {
            kind: "warning",
            severity: "high",
            surfaces: ["banner", "inbox"],
            title: "重要提示",
            body: "{{text}}",
            closable: true,
        },
    },
];
export function applyTemplate(tpl, vars) {
    const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
    const input = structuredClone(tpl.input);
    input.title = fill(input.title);
    if (input.body)
        input.body = fill(input.body);
    if (input.actions)
        input.actions = input.actions.map((a) => ({ ...a, label: fill(a.label), url: fill(a.url) }));
    return input;
}
export function mergeTemplates(extra) {
    if (!extra?.length)
        return BUILTIN_TEMPLATES;
    const map = new Map(BUILTIN_TEMPLATES.map((t) => [t.key, t]));
    for (const t of extra)
        map.set(t.key, t);
    return [...map.values()];
}
