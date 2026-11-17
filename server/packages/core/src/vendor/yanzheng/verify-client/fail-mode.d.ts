/**
 * 验证服务不可用时往哪边倒(docs/security-platform.md §5「故障策略」,业主 2026-11-02 定):
 *   - 站点配置 failClosed 里的场景 → 拒绝(提示稍后再试);默认 register / sms / reset / withdraw
 *   - 其余(login、browse,以及默认的 pay —— 与 zhifu human-verify.ts 现行为一致)→ 放行,站点告警 + 自己限流
 * failClosed 在雷池站点配置里改(GET /v1/s/policy 下发),业主要把 pay 改成拒绝不用改代码。
 * 登录 fail-open 时站点**必须**自己对登录限流(yanzheng 命名策略 login.player),否则打挂验证服务即可无限撞库。
 */
/** play = 游戏内连点闸 / 疑似脚本操作时的人机复核(2.42.0,业主 11-06 统一) */
export type Scene = "login" | "browse" | "register" | "sms" | "reset" | "pay" | "withdraw" | "play";
export declare const DEFAULT_FAIL_CLOSED: readonly Scene[];
export declare const isScene: (v: unknown) => v is Scene;
/**
 * 中心下发的 failClosed → 只留已知场景名(逐字匹配,大小写不对也不认)。
 * 不是数组返回 null(沿用上一份);`dropped` 是被丢掉的条目,调用方据此告警。
 * 🔴 为什么不照单全收:`failClosed.includes(scene)` 找不到就是「放行」,所以一份拼错的下发
 * 会让 register / sms / reset / withdraw 静默变成故障放行 —— 配置写坏的后果不能是防线消失。
 * 真正的空数组(scenes 与 dropped 都为空)是合法的「全部故障放行」,由调用方照办(见 site-policy.ts)。
 */
export declare function parseFailClosed(v: unknown): {
    scenes: Scene[];
    dropped: unknown[];
} | null;
export declare function failMode(scene: Scene, failClosed?: readonly Scene[]): "open" | "closed";
/** 一次调用的三种结局。`unavailable` = 网络错 / 超时 / 5xx / 本站接入配置错(签名、Host),不是玩家的错 */
export type CallResult<T> = {
    status: "ok";
    body: T;
} | {
    status: "rejected";
    httpStatus: number;
    error: string;
    body: Record<string, unknown>;
} | {
    status: "unavailable";
    reason: string;
};
export type Decision = "allow" | "deny" | "retry-later";
/**
 * 把调用结果翻译成业务动作。`passed` 判断 ok 的响应体里业务上是否通过(如 `b => b.success`)。
 * unavailable 时按场景的故障方向:open → allow(调用方记告警),closed → retry-later(提示稍后再试)。
 * 用客户端实例上的 `decide` 会自动带上雷池下发的本站 failClosed;这个独立版本用传入的(缺省 = 默认值)。
 */
export declare function decide<T>(scene: Scene, r: CallResult<T>, passed: (body: T) => boolean, failClosed?: readonly Scene[]): Decision;