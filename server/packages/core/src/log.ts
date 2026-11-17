// core 里「出错了但不能挡住主流程」的地方（登录补发试用、付款时记代理商分成）用的日志出口。
// API 启动时用 setCoreLogger(app.log) 接到应用日志（带级别、进同一个日志流）；没接时落到 console。
// 只记标识（账号 id、订单号）和错误信息，不记手机号 / 用户名 / 令牌。
export type CoreLogger = { warn(obj: object, msg: string): void; error(obj: object, msg: string): void }

const consoleLogger: CoreLogger = {
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
}
let current: CoreLogger = consoleLogger

export function setCoreLogger(logger: CoreLogger | null) { current = logger ?? consoleLogger }
export const coreLog: CoreLogger = {
  warn: (obj, msg) => current.warn(obj, msg),
  error: (obj, msg) => current.error(obj, msg),
}
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
