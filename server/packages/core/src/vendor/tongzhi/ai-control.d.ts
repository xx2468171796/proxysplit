export interface AiControlOptions {
    token: string | undefined | null;
    minTokenLength?: number;
    allowIp?: (ip: string) => boolean;
    /** 署名头,默认 x-tz-actor */
    actorHeader?: string;
}
export interface AiControlIdentity {
    actor: string;
    sub: string;
}
export interface AiControlRequestLike {
    ip: string;
    headers: Record<string, string | string[] | undefined>;
}
export declare const LOOPBACK_IPS: ReadonlySet<string>;
export declare const isLoopbackIp: (ip: string) => boolean;
export declare function createTongzhiAiControl(opts: AiControlOptions): {
    enabled: boolean;
    authenticate: (req: AiControlRequestLike) => AiControlIdentity | null;
    isBearerAttempt: (req: AiControlRequestLike) => boolean;
};
export type TongzhiAiControl = ReturnType<typeof createTongzhiAiControl>;
/** 从 Web 标准 Headers 取成 handler 需要的形状 */
export declare function headersToRecord(h: Headers): Record<string, string>;