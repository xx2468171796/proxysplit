/**
 * tongzhi(通知)—— 统一通知模块的类型契约。
 *
 * 一份模型装下「公告」和「站内信」:
 *   - Notice        一条通知的定义(全员公告、定向消息都在这;定向靠 audience + delivery 索引)
 *   - NoticeDelivery 定向通知的 (noticeId, userId) 索引行,可带每人不同的 payload
 *   - NoticeReceipt  某人对某条的回执:seen(铃铛看过)≠ read(点开)≠ archived,外加弹窗计数与「今日不再提示」
 *
 * 展示面(surfaces)由同一条通知勾选:inbox 铃铛收件箱 / modal 登录弹窗 / marquee 跑马灯 / banner 横幅 / toast 即时提示。
 * 包内**永不存**昵称/手机号/登录名,用户只有不透明 id;受众里的会员档位/标签/角色由宿主在读取时投影进来(PlayerContext)。
 */
export const NOTICE_KINDS = ["system", "maintenance", "event", "reward", "warning"];
export const SEVERITIES = ["low", "normal", "high", "critical"];
export const SURFACES = ["inbox", "modal", "marquee", "banner", "toast"];
export const FREQUENCY_MODES = ["once", "daily", "every", "gap"];
export const NOTICE_STATUSES = ["draft", "published", "revoked"];
export const NOTICE_PHASES = ["draft", "scheduled", "live", "expired", "revoked"];
export const AUDIENCE_TYPES = ["all", "users", "tiers", "tags", "roles"];
export class TongzhiError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "TongzhiError";
        this.code = code;
    }
}
