export declare const PAY_UI_VERSION = 1;
/**
 * queue（4.8）= 排队中：站点用自己的弹窗显示 body，并按 `queue` 每秒本地倒数、`poll_ms` 后用同样参数再提交下单
 * （位置不变，不会插队）；玩家关掉 = 不再提交，服务端 15 秒没心跳就让他出队。老站点不认识 → 当 dialog 显示。
 */
/**
 * outage（5.4，业主 11-04）= 支付通道异常：站点用**自己的**弹窗 / 页面（原生组件、手机适配）显示 title + body，
 * 只有「我知道了」；不排队、不出二维码、关掉正在显示的二维码 / 倒计时 / 排队提示。老站点不认识 → 当 dialog 显示。
 */
export type PayUiKind = "dialog" | "toast" | "inline" | "queue" | "outage";
export type PayUiTone = "info" | "success" | "warn" | "error";
/**
 * 按钮动作（站点映射成自己的调用）：
 * - resume   继续支付 `ref` 这笔单（SitePay.resume）→ 显示返回的二维码
 * - cancel   取消 `ref` 这笔单；`retry: true` = 取消后用刚才的金额重新下单（createOrder 带 onOpen: "cancel"）
 * - query    立刻查单（SitePay.check）→ 显示返回的 ui
 * - close    关掉提示
 * - open_url 打开 `url`
 * - challenge（4.10）先过本站滑块（站点自己的 yanzheng 验证），通过后用同样金额再下单并带 challengePassed
 */
export type PayUiAction = "resume" | "cancel" | "query" | "close" | "open_url" | "challenge";
export interface PayUiButton {
    label: string;
    action: PayUiAction;
    primary?: boolean;
    /** resume / cancel / query 针对的站点订单号 */
    ref?: string;
    /** cancel：取消后重新下单 */
    retry?: boolean;
    /** 4.15：点了先让玩家确认这句话（站点用自己的确认框；不认识的老渲染器直接执行） */
    confirm?: string;
    /** open_url */
    url?: string;
}
export interface PayUi {
    v: number;
    kind: PayUiKind;
    tone: PayUiTone;
    title?: string;
    body: string;
    buttons: PayUiButton[];
    /** kind = queue 时：前面几位、预计毫秒、多久后再提交 */
    queue?: PayUiQueue;
    /**
     * 4.15 实时倒数：站点每秒用 `countdownBody(ui)` 把 `text` 里的 `{mmss}` 换成离 `until` 还剩的 mm:ss 显示；
     * 到点（剩 0）由站点按 `kind` 收尾（二维码 → 显示「二维码已过期」，冷却 → 允许再下单）。不认识的老站点照旧显示 body。
     */
    countdown?: PayUiCountdown;
}
export interface PayUiCountdown {
    /** ISO 时间 */
    until: string;
    /** 含 `{mmss}` 的文案 */
    text: string;
}
export interface PayUiQueue {
    position: number;
    eta_ms: number;
    poll_ms: number;
}
/** 4.15 业主 11-04：取消 / 离开都要先确认，提醒会丢位置 */
export declare const PAY_CANCEL_CONFIRM = "\u53D6\u6D88\u540E\u9700\u8981\u91CD\u65B0\u6392\u961F\uFF0C\u786E\u5B9A\u53D6\u6D88\uFF1F";
/** 秒 → mm:ss（超过 1 小时 h:mm:ss） */
export declare function mmss(sec: number): string;
/** 倒数剩余秒（没有倒数 = null） */
export declare function countdownLeftSec(ui: Pick<PayUi, "countdown">, now?: number): number | null;
/** 站点每秒调用：带倒数的 ui → 当前该显示的正文 */
export declare function countdownBody(ui: Pick<PayUi, "body" | "countdown">, now?: number): string;
/**
 * 二维码弹窗里常驻的一行（4.15 业主 11-04：实时倒数 + 「请勿重复获取二维码」）+ 「我已支付」「取消订单」（先确认）。
 * 同一笔单重开弹窗 / 刷新 / 再点充值，服务端都回同一张二维码，站点照这个 ui 接着倒数。
 */
export declare function uiPayNotice(input: {
    siteOrderNo: string;
    expireAt: string;
    unpaid: {
        today: number;
        nextWaitSec: number;
        leftBeforeBan: number;
    } | null;
    now?: number;
}): PayUi;
/** 4.15 二维码到点了（订单还在）：只给一个「重新获取」，服务端按每 10 分钟次数上限放行 */
export declare function uiQrExpired(input: {
    siteOrderNo: string;
}): PayUi;
/** 4.15 下单 / 重新获取过于频繁（IP / 设备 / 次数冷却）：实时倒数，到点可再试 */
export declare function uiCooldown(input: {
    waitSec: number;
    now?: number;
    text?: string;
}): PayUi;
/** 已有一笔未付订单 */
export declare function uiOpenOrder(input: {
    siteOrderNo: string;
    amountCents: number;
    sameSite: boolean;
    siteName: string | null;
}): PayUi;
/** 被拦（冷却 / 封禁 / 排队满 / 设备 / IP / 信任 / 金额…）：正文 = 服务端原话 */
export declare function uiBlocked(message: string): PayUi;
/** 5.4 通道异常默认文案（真文案由支付中心后台「支付中断」配置下发，这里只是兜底） */
export declare const PAY_OUTAGE_TITLE = "\u652F\u4ED8\u901A\u9053\u5F02\u5E38";
export declare const PAY_OUTAGE_BODY = "\u652F\u4ED8\u6E20\u9053\u5F02\u5E38\uFF0C\u6B63\u5728\u62A2\u4FEE\uFF0C\u6062\u590D\u540E\u4F1A\u7B2C\u4E00\u65F6\u95F4\u901A\u77E5\u3002\u53EF\u4EE5\u8054\u7CFB\u5B98\u65B9\u4EE3\u7406\u5145\u503C \u5FAE\u4FE1\uFF1AyanF1149 / \u6216 ZaiXiangJian08 \u6709\u5176\u4ED6\u7591\u95EE\u8054\u7CFB\u5B98\u65B9\u5BA2\u670D\uFF1Azyg69996";
/** 5.4 支付通道异常（站点原生弹窗 / 页面；不排队、不出码） */
export declare function uiOutage(input?: {
    title?: string | null;
    body?: string | null;
}): PayUi;
/** 5.4 这个 ui 是不是「通道异常」（站点据此关掉二维码 / 倒计时 / 排队，换成异常提示） */
export declare function isOutageUi(ui: PayUi | null | undefined): boolean;
/** 排队中（4.8）：站点每秒倒数 eta、poll_ms 后同参数再提交下单；「取消排队」= 关掉并通知服务端离开 */
export declare function uiQueued(input: {
    position: number;
    etaMs: number;
    pollMs?: number;
    text: string;
}): PayUi;
/** 排队预计时间：始终按秒显示（业主 11-05：「预计 3 秒」；≥ 60 秒带分钟），至少 1 秒 */
export declare function queueEtaText(etaMs: number): string;
/** 排队耐心提示（业主 11-05） */
export declare const QUEUE_PATIENCE = "\u8BF7\u8010\u5FC3\u7B49\u5F85\uFF0C\u79BB\u5F00\u6216\u53D6\u6D88\u9700\u91CD\u65B0\u6392\u961F\u3002";
/**
 * 排队文案（站点本地倒数时用同一句话，和服务端一致）。6.3 业主 11-05：前面人数始终显示（含 0），预计秒数始终显示。
 */
export declare function queueLine(position: number, etaMs: number): string;
/** 「我已支付」的结果 */
export declare function uiCheckResult(status: string): PayUi;
/** 从支付宝切回来还没付（查单响应带着，站点只在「页面重新可见」时显示） */
export declare function uiReturnedUnpaid(input: {
    siteOrderNo: string;
    amountCents: number;
}): PayUi;
/** 站点收到的 ui 不可信时（版本更高 / 字段坏）兜底：只显示正文 + 关闭 */
export declare function parsePayUi(raw: unknown): PayUi | null;
/** 站点渲染器点按钮后的统一分发：站点只提供这五个函数（各自调自己的后端路由 / SDK） */
export interface PayUiHandlers {
    resume(ref: string): unknown;
    /** 取消 ref（可空：别的站的单由服务端按玩家取消）后用刚才的金额重新下单，即 createOrder({ ..., onOpen: "cancel" }) */
    cancelAndRetry(ref: string | undefined): unknown;
    /** 只取消不重下（retry 不为 true 时） */
    cancel?(ref: string): unknown;
    query(ref: string): unknown;
    close(): unknown;
    openUrl?(url: string): unknown;
    /** 4.10 风险玩家下单前的滑块：站点弹自己的滑块，通过后同金额再下单（challengePassed: true）；没接 = 关闭 */
    challenge?(): unknown;
}
export declare function runPayUiAction(b: PayUiButton, h: PayUiHandlers): unknown;
/**
 * 4.13（业主 11-03「排队时不要拉二维码、倒计时实时、点我知道了不能就没了」）：站点把中心的拒绝换成玩家提示的唯一入口。
 * 优先用服务端下发的 `details.ui`；没有 / 坏了时：QUEUED + `details.queue` → 排队提示（kind queue，站点继续轮询、轮到自动再下单），
 * 绝不退成「暂时无法下单 + 我知道了」（那会让排队中的玩家点一下就丢单）；其余 → uiBlocked(message)。
 */
export declare function refusalPayUi(code: string, message: string, details: Readonly<Record<string, unknown>> | null | undefined): PayUi;
/** 5.4 这条拒绝是不是「支付通道异常」（站点显示原生异常提示，不排队、不出码、不算失败重试） */
export declare function isOutageRefusal(code: string, details: Readonly<Record<string, unknown>> | null | undefined): boolean;
/** 这条拒绝是不是「还在排队」（站点据此保持下单流程，不当失败收尾） */
export declare function isQueuedRefusal(code: string, details: Readonly<Record<string, unknown>> | null | undefined): boolean;