/**
 * `zhifu/risk` —— 支付风控决策引擎（纯函数 + 存储接口，无 I/O）。支付中心（zhifu-service）消费它；
 * 新项目接中心即自动拥有整套风控，不需要在站点侧实现。见 INTEGRATION.md「风控」。
 */
export * from "./catalog.ts";
export * from "./resolve.ts";
export * from "./scan.ts";
export * from "./burst.ts";
export * from "./weight.ts";
export type * from "./store.ts";
export * from "./touch-hint.ts";
export * from "./signals.ts";