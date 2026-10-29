/**
 * zhanghao/recharge-adjustments/http —— 累充调整的后台 HTTP 处理器(框架无关,与 `zhanghao/http/handlers` 同一套输入输出形状)。
 *
 * 5 条路由,全部 admin(鉴权由宿主做,这里只复核 `auth.role === "admin"`):
 *
 *   GET   /admin/users/:id/recharge-adjustments          汇总(真实 / 调整 / 有效)+ 全部调整(含已作废)
 *   POST  /admin/users/:id/recharge-adjustments          新增   { amountCents: "10000" | amountYuan: "100.00", reason, requestId }
 *   PATCH /admin/recharge-adjustments/:id                改     { amountCents? | amountYuan?, reason?, expectedRevision, requestId }
 *   POST  /admin/recharge-adjustments/:id/revoke         删(作废){ reason, expectedRevision, requestId }
 *   GET   /admin/users/:id/recharge-adjustment-events    流水   ?beforeId=&limit=
 *
 * 金额在 JSON 里一律是**字符串**(分):bigint 进 JSON.stringify 会直接抛,转 number 超 2^53 会丢末位。
 * 也接受 `amountYuan`("100.50" / "-20"),换算不经浮点。两个都给时必须一致。
 */
import type { HandlerInput, HandlerResult } from "./http/handlers.ts";
import { type RechargeAdjustmentEvent, type RechargeAdjustmentRecord, type RechargeAdjustments } from "./recharge-adjustments.ts";
export interface RechargeAdjustmentView {
    id: string;
    userId: string;
    /** 分(字符串) */
    amountCents: string;
    reason: string;
    status: "active" | "revoked";
    revision: number;
    requestId: string;
    createdBy: string;
    createdAt: string;
    updatedBy: string | null;
    updatedAt: string;
    revokedBy: string | null;
    revokedAt: string | null;
    revokeReason: string | null;
    /** 操作人显示名(宿主传了 `operatorNames` 才有;没有时界面退回显示 id) */
    createdByName?: string | null;
    updatedByName?: string | null;
    revokedByName?: string | null;
}
export interface RechargeAdjustmentEventView {
    id: string;
    adjustmentId: string;
    userId: string;
    action: "create" | "update" | "revoke";
    before: {
        amountCents: string;
        reason: string;
        status: "active" | "revoked";
    } | null;
    after: {
        amountCents: string;
        reason: string;
        status: "active" | "revoked";
    };
    operatorId: string;
    /** 操作人显示名(宿主传了 `operatorNames` 才有) */
    operatorName?: string | null;
    requestId: string;
    note: string | null;
    createdAt: string;
}
export interface RechargeAdjustmentSummaryView {
    userId: string;
    /** 真实充值(分);宿主没提供 realRechargeCents 时为 null(面板只显示调整部分) */
    realCents: string | null;
    /** 生效中调整之和(分,可负) */
    adjustmentCents: string;
    /** max(0, 真实 + 调整);真实未知时为 null */
    effectiveCents: string | null;
    items: RechargeAdjustmentView[];
}
export interface RechargeAdjustmentResultView {
    item: RechargeAdjustmentView;
    replayed: boolean;
}
export interface RechargeAdjustmentEventListView {
    items: RechargeAdjustmentEventView[];
}
export declare function adjustmentView(r: RechargeAdjustmentRecord): RechargeAdjustmentView;
export declare function adjustmentEventView(e: RechargeAdjustmentEvent): RechargeAdjustmentEventView;
export declare const RECHARGE_ADJUSTMENT_ROUTES: readonly [{
    readonly key: "adminRechargeAdjustments";
    readonly method: "GET";
    readonly path: "/admin/users/:id/recharge-adjustments";
    readonly auth: "admin";
}, {
    readonly key: "adminCreateRechargeAdjustment";
    readonly method: "POST";
    readonly path: "/admin/users/:id/recharge-adjustments";
    readonly auth: "admin";
}, {
    readonly key: "adminUpdateRechargeAdjustment";
    readonly method: "PATCH";
    readonly path: "/admin/recharge-adjustments/:id";
    readonly auth: "admin";
}, {
    readonly key: "adminRevokeRechargeAdjustment";
    readonly method: "POST";
    readonly path: "/admin/recharge-adjustments/:id/revoke";
    readonly auth: "admin";
}, {
    readonly key: "adminRechargeAdjustmentEvents";
    readonly method: "GET";
    readonly path: "/admin/users/:id/recharge-adjustment-events";
    readonly auth: "admin";
}];
export type RechargeAdjustmentRouteKey = (typeof RECHARGE_ADJUSTMENT_ROUTES)[number]["key"];
export interface RechargeAdjustmentHttpOptions {
    /**
     * 该用户的**真实**充值(分,不含调整)。传了,汇总里才有「真实 / 有效」两栏;
     * 必须与宿主「有效累充」唯一入口用的是同一个口径(否则面板上的数与门槛判定对不上)。
     */
    realRechargeCents?: (userId: string) => Promise<bigint>;
    /**
     * 操作人 id → 显示名(后台账号的用户名)。传了,视图里带 `createdByName / updatedByName / revokedByName / operatorName`,
     * 面板显示名字而不是一串 id;查不到的 id 不放进 Map 即可(界面退回显示 id)。一次请求只调一次(批量)。
     */
    operatorNames?: (ids: string[]) => Promise<Map<string, string>>;
    onInternalError?: (err: unknown, routeKey: RechargeAdjustmentRouteKey) => void;
}
/** 从 body 里读金额:amountCents(整数分字符串 / 安全整数)或 amountYuan(元字符串);都没有返回 undefined */
export declare function amountFromBody(body: Record<string, unknown>): bigint | undefined;
declare function buildRechargeAdjustmentHandlers(svc: RechargeAdjustments, opts?: RechargeAdjustmentHttpOptions): {
    adminRechargeAdjustments(input: HandlerInput): Promise<HandlerResult<RechargeAdjustmentSummaryView>>;
    adminCreateRechargeAdjustment(input: HandlerInput): Promise<HandlerResult<RechargeAdjustmentResultView>>;
    adminUpdateRechargeAdjustment(input: HandlerInput): Promise<HandlerResult<RechargeAdjustmentResultView>>;
    adminRevokeRechargeAdjustment(input: HandlerInput): Promise<HandlerResult<RechargeAdjustmentResultView>>;
    adminRechargeAdjustmentEvents(input: HandlerInput): Promise<HandlerResult<RechargeAdjustmentEventListView>>;
};
export type RechargeAdjustmentHandlers = ReturnType<typeof createRechargeAdjustmentHandlers>;
/** 对外的处理器：错误体统一带 kind（error-kind.ts，公司基础契约 jichu 的 ErrorBody） */
export declare function createRechargeAdjustmentHandlers(svc: RechargeAdjustments, opts?: RechargeAdjustmentHttpOptions): ReturnType<typeof buildRechargeAdjustmentHandlers>;
export {};