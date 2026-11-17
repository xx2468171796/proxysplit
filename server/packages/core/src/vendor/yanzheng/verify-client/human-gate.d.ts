/**
 * 人机闸门(统一接法,2026-11-06 业主:登录 / 注册 / 付款等安全弹窗一律统一组件 LcVerify)。
 *
 * 站点前端 `LcVerify.open({ action })` 拿一次性 token,服务端只调这一个:
 *
 *   const gate = createHumanGate({ client: () => lcv, enabled: () => 读站点开关 });
 *   const r = await gate.check(token, "login", { remoteIp, deviceFp });
 *   if (!r.pass) throw new AppError("BAD_REQUEST", r.message);
 *
 * 判定全在 `payGate`(签名核销、单次、绑站点 host + action;没 token 自己探服务;故障方向按该动作的场景)。
 * 本层只加各站原来各写一份的东西:开关、玩家看得懂的拒绝文案、故障放行时的告警。
 *
 * 2.41.0 起开关在雷池中心(面板按站按场景配,`client.gateRequired`),每次结局自动上报中心(`client.reportGate`);
 * 站点**不传 `enabled`**,不再留本地开关。`enabled` 只留给测试 / 极特殊场景。
 */
import type { GateOutcome } from "./gate-policy.ts";
import type { PayGateInput, PayGateReason, PayGateResult } from "./index.ts";
export type HumanRefusal = "token-required" | "bad-token" | "busy";
/** 玩家看到的拒绝文案(各站统一;要改改这里,别在站点里另写) */
export declare const HUMAN_GATE_TEXT: Readonly<Record<HumanRefusal, string>>;
export type HumanGateResult = 
/** reason "skipped" = 中心把这个场景配成不验 */
{
    pass: true;
    verified: boolean;
    reason: PayGateReason | "skipped";
} | {
    pass: false;
    refusal: HumanRefusal;
    message: string;
    reason: PayGateReason;
    detail?: string;
};
export interface HumanGateOptions {
    /** 本站 SDK 客户端(createSecurityClient);返回 null = 本站没配验证中心 → 放行并告警 */
    client: () => GateClient | null;
    /** 站点开关(如 app_config `security.loginHumanVerify`);不传 = 常开。读失败请返回 true(安全一侧) */
    enabled?: (action: string) => boolean | Promise<boolean>;
    /** 故障放行 / 拒绝时的告警(接站点 logger) */
    warn?: (msg: string, meta: Record<string, unknown>) => void;
}
export interface GateClient {
    payGate(input: PayGateInput): Promise<PayGateResult>;
    /** 中心开关(SecurityClient 自带);没有 = 必验 */
    gateRequired?(action: string): Promise<boolean>;
    /** 结局上报(SecurityClient 自带);没有 = 不报 */
    reportGate?(action: string, outcome: GateOutcome): void;
}
export declare function createHumanGate(o: HumanGateOptions): {
    check(token: string | null | undefined, action: string, ctx?: {
        remoteIp?: string;
        deviceFp?: string;
    }): Promise<HumanGateResult>;
};
export type HumanGate = ReturnType<typeof createHumanGate>;