/**
 * 和公司其他包联动:事件 → 站内通知(tongzhi)/ 实时刷新(shuaxin)。
 * 包不 import 它们(和兄弟包一致,结构类型 + 宿主注入):
 *
 *   notify:        (n) => tongzhi.send({ userId: n.userId, kind: n.kind, title: n.title, body: n.body, idemKey: n.idemKey, actions: n.url ? [{ label: "查看", url: n.url }] : [] })
 *   publishChange: (cs) => publisher.publish(cs)          // shuaxin createChangePublisher(redis, prefix)
 *
 * 两者都在事务提交后才调;失败只记日志,不影响记账。
 */
import type { FxEvent } from "./types.ts";
/** 发给一个人的站内通知(和 tongzhi SendInput 对得上的子集);idemKey 稳定,重放不会重复发 */
export interface FxNotice {
    userId: string;
    kind: "reward" | "system";
    title: string;
    body: string;
    idemKey: string;
    url: string | null;
}
/** 和 shuaxin ChangeInput 同形:只带 id,不带值,前端收到后用自己的权限重新拉 */
export interface FxChange {
    tenantId: string;
    event: string;
    ref: {
        module: string;
        type: string;
        id: string;
    };
    rows?: string[];
}
export interface FxTexts {
    memberBound: {
        title: string;
        body: string;
    };
    commissionCreated: {
        title: string;
        body: string;
    };
    commissionHeld: {
        title: string;
        body: string;
    };
    commissionReleased: {
        title: string;
        body: string;
    };
    commissionReversed: {
        title: string;
        body: string;
    };
    commissionApproved: {
        title: string;
        body: string;
    };
    commissionVoided: {
        title: string;
        body: string;
    };
    commissionAdjusted: {
        title: string;
        body: string;
    };
    withdrawalPaid: {
        title: string;
        body: string;
    };
    withdrawalRejected: {
        title: string;
        body: string;
    };
    applicationApproved: {
        title: string;
        body: string;
    };
    applicationRejected: {
        title: string;
        body: string;
    };
}
/** 文案里的 {amount} {level} {reason} {net} 会被替换 */
export declare const DEFAULT_TEXTS: FxTexts;
export interface NoticeOptions {
    texts: FxTexts;
    formatAmount: (amount: bigint) => string;
    /** 通知里「查看」跳哪(推广中心页);null = 不带按钮 */
    url: string | null;
}
/** 分 → ¥12.34(负数带 -) */
export declare const formatCny: (cents: bigint) => string;
/** 事件 → 要发的站内通知 */
export declare function noticesFor(ev: FxEvent, o: NoticeOptions): FxNotice[];
/**
 * 事件 → 实时变更。前端订阅:
 *   推广人自己的页面 watch({ module: "fenxiao", type: "user", id: <userId> })
 *   后台分销页     watch({ module: "fenxiao", type: "admin", id: "all" })
 */
export declare function changesFor(ev: FxEvent, tenantId: string): FxChange[];