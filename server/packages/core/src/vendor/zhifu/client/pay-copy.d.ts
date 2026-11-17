export declare const PAY_COPY: {
    readonly title: "支付宝扫码支付";
    readonly scan: "请使用【支付宝】扫码支付";
    readonly jumpButton: "跳转支付宝支付";
    /** 6.11 微信通道（wx_qr）：电脑、手机都只给二维码，没有跳转按钮（浏览器打不开微信付款码） */
    readonly wxScanTitle: "请使用微信扫码付款";
    /** 6.11 手机上看到微信二维码时的步骤提示 */
    readonly wxPhoneHint: "微信不支持识别本机相册里的付款码。请长按保存或截图，发到另一台手机或电脑上打开，再用本机微信「扫一扫」扫屏幕付款；也可以直接让朋友用微信扫这个码";
    /** 6.13.1 手机上微信付款码（wx_qr）的标题：本机相册识别被微信拒绝，只能另一台设备的摄像头扫 */
    readonly wxPhoneTitle: "请用另一台手机的微信扫码付款";
    /** 6.12 微信通道手机端（wx_h5）：点开上游付款页（页上有二维码），按钮下方提示 */
    readonly wxJumpButton: "打开微信付款页";
    readonly wxJumpHint: "打开后长按二维码保存，再用微信扫一扫 → 相册";
    /** 6.13 手机微信：中心代取的上游付款页二维码图（可长按保存）下方提示 */
    readonly wxSaveHint: "长按二维码保存到相册（或截图），打开微信 → 扫一扫 → 右上角相册选这张图付款";
    /** 跳转按钮下方常驻：跳转在部分浏览器 / App 内会被拦（6.2 业主 11-05 文案；中心可按站 / 通道改，见 payJump hint） */
    readonly jumpFallback: "跳转不了？可以截图保存二维码，在支付宝里从相册扫码付款";
    /** {time} = mm:ss */
    readonly countdown: "二维码 {time} 后失效，请勿重复付款";
    readonly expired: "二维码已失效，请关闭后重新下单";
    readonly waiting: "付款完成后自动到账，请勿关闭此窗口";
    readonly success: "充值成功，已到账";
    /** 11-05：从支付宝回来 / 点「我已支付」后到账前（中心可改：pay-config copy.confirming） */
    readonly confirming: "支付确认中，通常需要几秒钟，请耐心等待，不要关闭页面（关闭页面也会自动到账）";
    /** 转圈旁的计时；{n} = 秒 */
    readonly confirmingSeconds: "已等待 {n} 秒";
    /** 4.1 全站下单排队：下单请求还没回来时显示 */
    readonly queued: "排队中，正在创建订单…";
    /** {n} = 前面还有几人（站点能拿到 orderQueueStatus 时用） */
    readonly queuedPosition: "排队中，前面还有 {n} 人，正在创建订单…";
    readonly queueFull: "当前排队人数较多，请稍后再试";
    /** 4.1 全站封禁 */
    readonly banned: "您的支付权限已被取消，如有疑问请联系客服";
    /** 4.1 点支付前的规则弹窗 */
    readonly rulesTitle: "支付须知";
    readonly rulesConfirm: "我已知晓，继续支付";
    /** 4.2：窄屏（手机 ≤ 430px）按钮用这个，五个字一行放得下 */
    readonly rulesConfirmShort: "知晓并支付";
    readonly rulesCancel: "取消";
    /** 4.6 付款成功率：二维码弹窗里常驻一行。{ttl} 二维码有效期，{today} 今日已未付，{wait} 本单不付下一单要等多久 */
    readonly unpaidNotice: "请在 {ttl}内完成支付；未支付将计入未付次数（今日已 {today} 次，本单未付需等 {wait}才能再下单）";
    /** 接在 unpaidNotice 后面，剩 ≤ 3 次才显示：{left} 再几次未付将暂停支付权限 */
    readonly unpaidNoticeBan: "，再 {left} 次未付将暂停支付权限";
    /** 4.6 已有一笔未付订单时再下单。{amount} 金额（元），{site} 哪个站 */
    readonly openOrderTitle: "你有一笔未支付的订单";
    readonly openOrderBody: "你在{site}还有一笔 {amount} 元的订单未支付，可以继续支付，或取消后重新下单。";
    readonly openOrderContinue: "继续支付";
    readonly openOrderCancel: "取消后重新下单";
    /** 4.6「我已支付」按钮：点了立刻向通道查一次 */
    readonly paidCheck: "我已支付";
    readonly paidChecking: "正在确认付款…";
    readonly paidNotYet: "暂未查到付款。如已扣款请稍等片刻，到账后会自动通知；二维码失效前仍可继续支付。";
    /** 4.6 从支付宝回来还没付 */
    readonly returnedTitle: "订单还未支付";
    readonly returnedBody: "检测到这笔 {amount} 元的订单还没有完成支付，二维码有效期内可继续支付。";
    readonly returnedContinue: "继续支付";
    readonly returnedLater: "稍后再说";
    /** 4.6 被拦时的标题（正文 = 服务端 message 原样） */
    readonly blockedTitle: "暂时无法下单";
};