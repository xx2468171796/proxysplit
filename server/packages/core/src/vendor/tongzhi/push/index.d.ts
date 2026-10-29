/**
 * 跨站推送(推送式,不是中央存储):
 *   发送端(会员中心广播台)createPushSender → 对勾选的站逐站签名 POST,一站失败不影响别站,结果逐站返回
 *   接收端(各站)          createPushReceiver → 验签 + nonce 一次性 + 落自己的库(create/publish/revoke/revokeBatch)
 *
 * 密钥:每站一把(建议直接复用该站接会员中心时拿到的 apiSecret,少管一把);接收端按 x-tz-site 取对应密钥。
 * nonce 存储:接收端要给一个 `claim(nonce, ttlSec) → 第一次 true / 重复 false`(Redis SET NX EX 即可);
 * **拿不到就拒绝**(fail-closed),不是放行。
 *
 * 幂等:发送端给每站的 idemKey = `${idemKey}:${site}`,同一批重推不会重复出现;整批用同一个 batchId,可整批撤回。
 */
import type { Tongzhi } from "../service.ts";
import { type NoticeInput } from "../types.ts";
export type PushOp = {
    op: "create";
    notice: NoticeInput;
    publish?: boolean;
} | {
    op: "revoke";
    id: string;
} | {
    op: "revokeBatch";
    batchId: string;
};
export interface NonceStore {
    claim(nonce: string, ttlSec: number): Promise<boolean>;
}
export interface PushReceiverOptions {
    tongzhi: Tongzhi;
    /** 按来源站取密钥;单密钥宿主直接 `() => secret` */
    secretFor: (site: string) => string | null | undefined | Promise<string | null | undefined>;
    nonces: NonceStore;
    /** 允许的 op(默认全部) */
    allowOps?: PushOp["op"][];
}
export interface PushRequestLike {
    method: string;
    path: string;
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
}
/**
 * 推送报文在边界整形校验:验签只证明「是对方发的」,不证明「形状对」—— 对方站的 bug / 版本错位
 * 发来 `batchId: ["xs_a"]` 这种值,老写法会靠 String() 混过正则再在 service 里炸成 500。
 * 通知字段本身(标题长度、受众名单上限 5000、链接安全…)由 service 的 normalizeInput 统一校验,这里不重复。
 */
export declare function parsePushOp(raw: unknown): PushOp;
export declare function createPushReceiver(o: PushReceiverOptions): {
    handle: (req: PushRequestLike) => Promise<{
        status: number;
        body: unknown;
    }>;
};
export interface PushSite {
    slug: string;
    baseUrl: string;
    secret: string; /** 默认 /api/integrations/tongzhi/push */
    path?: string;
}
export interface PushSenderOptions {
    sites: PushSite[]; /** 发送端自报的身份(x-tz-site),默认 huiyuan */
    self?: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
}
export interface PushResult {
    slug: string;
    ok: boolean;
    status: number;
    body: unknown;
    error?: string;
}
export declare function createPushSender(o: PushSenderOptions): {
    create: (slugs: string[] | "all", notice: NoticeInput, opt?: {
        publish?: boolean;
        batchId?: string;
    }) => Promise<{
        batchId: string;
        results: PushResult[];
    }>;
    revokeBatch: (slugs: string[] | "all", batchId: string) => Promise<PushResult[]>;
    revoke: (slug: string, id: string) => Promise<PushResult>;
    sites: () => {
        slug: string;
        baseUrl: string;
    }[];
};
export type PushSender = ReturnType<typeof createPushSender>;