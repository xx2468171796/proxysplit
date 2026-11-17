/** 二维码弹窗全站统一文案（业主 2026-10-31 定稿；6.2 跳转提示换成 11-05 文案）。 */
import { PAY_BANNED_MESSAGE } from "../order/cooldown.js";
import { DEFAULT_JUMP_HINT, WX_JUMP_HINT, WX_OTHER_DEVICE_TITLE, WX_SCREENSHOT_GUIDE } from "../presentation/index.js";
export const PAY_COPY = {
    title: "支付宝扫码支付",
    scan: "请使用【支付宝】扫码支付",
    jumpButton: "跳转支付宝支付",
    /** 6.11 微信通道（wx_qr）：电脑、手机都只给二维码，没有跳转按钮（浏览器打不开微信付款码） */
    wxScanTitle: "请使用微信扫码付款",
    /** 6.11 手机上看到微信二维码时的步骤提示 */
    wxPhoneHint: WX_SCREENSHOT_GUIDE,
    /** 6.13.1 手机上微信付款码（wx_qr）的标题：本机相册识别被微信拒绝，只能另一台设备的摄像头扫 */
    wxPhoneTitle: WX_OTHER_DEVICE_TITLE,
    /** 6.12 微信通道手机端（wx_h5）：点开上游付款页（页上有二维码），按钮下方提示 */
    wxJumpButton: "打开微信付款页",
    wxJumpHint: WX_JUMP_HINT,
    /** 6.13 手机微信：中心代取的上游付款页二维码图（可长按保存）下方提示 */
    wxSaveHint: "长按二维码保存到相册（或截图），打开微信 → 扫一扫 → 右上角相册选这张图付款",
    /** 跳转按钮下方常驻：跳转在部分浏览器 / App 内会被拦（6.2 业主 11-05 文案；中心可按站 / 通道改，见 payJump hint） */
    jumpFallback: DEFAULT_JUMP_HINT,
    /** {time} = mm:ss */
    countdown: "二维码 {time} 后失效，请勿重复付款",
    expired: "二维码已失效，请关闭后重新下单",
    waiting: "付款完成后自动到账，请勿关闭此窗口",
    success: "充值成功，已到账",
    /** 11-05：从支付宝回来 / 点「我已支付」后到账前（中心可改：pay-config copy.confirming） */
    confirming: "支付确认中，通常需要几秒钟，请耐心等待，不要关闭页面（关闭页面也会自动到账）",
    /** 转圈旁的计时；{n} = 秒 */
    confirmingSeconds: "已等待 {n} 秒",
    /** 4.1 全站下单排队：下单请求还没回来时显示 */
    queued: "排队中，正在创建订单…",
    /** {n} = 前面还有几人（站点能拿到 orderQueueStatus 时用） */
    queuedPosition: "排队中，前面还有 {n} 人，正在创建订单…",
    queueFull: "当前排队人数较多，请稍后再试",
    /** 4.1 全站封禁 */
    banned: PAY_BANNED_MESSAGE,
    /** 4.1 点支付前的规则弹窗 */
    rulesTitle: "支付须知",
    rulesConfirm: "我已知晓，继续支付",
    /** 4.2：窄屏（手机 ≤ 430px）按钮用这个，五个字一行放得下 */
    rulesConfirmShort: "知晓并支付",
    rulesCancel: "取消",
    /** 4.6 付款成功率：二维码弹窗里常驻一行。{ttl} 二维码有效期，{today} 今日已未付，{wait} 本单不付下一单要等多久 */
    unpaidNotice: "请在 {ttl}内完成支付；未支付将计入未付次数（今日已 {today} 次，本单未付需等 {wait}才能再下单）",
    /** 接在 unpaidNotice 后面，剩 ≤ 3 次才显示：{left} 再几次未付将暂停支付权限 */
    unpaidNoticeBan: "，再 {left} 次未付将暂停支付权限",
    /** 4.6 已有一笔未付订单时再下单。{amount} 金额（元），{site} 哪个站 */
    openOrderTitle: "你有一笔未支付的订单",
    openOrderBody: "你在{site}还有一笔 {amount} 元的订单未支付，可以继续支付，或取消后重新下单。",
    openOrderContinue: "继续支付",
    openOrderCancel: "取消后重新下单",
    /** 4.6「我已支付」按钮：点了立刻向通道查一次 */
    paidCheck: "我已支付",
    paidChecking: "正在确认付款…",
    paidNotYet: "暂未查到付款。如已扣款请稍等片刻，到账后会自动通知；二维码失效前仍可继续支付。",
    /** 4.6 从支付宝回来还没付 */
    returnedTitle: "订单还未支付",
    returnedBody: "检测到这笔 {amount} 元的订单还没有完成支付，二维码有效期内可继续支付。",
    returnedContinue: "继续支付",
    returnedLater: "稍后再说",
    /** 4.6 被拦时的标题（正文 = 服务端 message 原样） */
    blockedTitle: "暂时无法下单",
};
