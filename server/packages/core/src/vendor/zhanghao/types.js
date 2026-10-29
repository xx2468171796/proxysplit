/**
 * zhanghao(账号)—— 公共类型与错误。整个包只认这里定义的形状;
 * store / service / http / react 都从这一份 import,不许各自再抄一份。
 *
 * 隐私纪律(与 liaotian / tuiguang 同):
 *   - userId 是不透明字符串(宿主列可以是 bigint,经 userIdCodec 换算);
 *   - 「公开投影」PublicUser 里只有 userId / displayName / avatarKey / level,
 *     **永不带 username / phone / email** —— 玩家之间只能看到昵称。
 */
export class ZhanghaoError extends Error {
    code;
    detail;
    constructor(code, message, detail) {
        super(message);
        this.name = "ZhanghaoError";
        this.code = code;
        this.detail = detail;
    }
}
/**
 * 判断是不是 zhanghao 抛的业务错误。
 *
 * ⚠ **按 name + code 判,不用 instanceof**:Next.js(server action / route handler / RSC 分层打包)
 * 与 vendored+依赖并存的宿主里,同一个包会被加载成多份,`instanceof` 对另一份实例恒为 false ——
 * 表现是「用户名已被占用」变成「服务器内部异常」,且不报错(V7 2026-09-23 本地并发注册撞到)。
 */
export function isZhanghaoError(err, code) {
    if (err instanceof ZhanghaoError)
        return code === undefined || err.code === code;
    const e = err;
    return (!!e &&
        typeof e === "object" &&
        e.name === "ZhanghaoError" &&
        typeof e.code === "string" &&
        typeof e.message === "string" &&
        (code === undefined || e.code === code));
}
