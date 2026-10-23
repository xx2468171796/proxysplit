/**
 * fenxiao(多级分销)域类型 —— tuiguang 1.8.0 新增,给「分销商 / 经销商 / 推广员多级返佣」用。
 *
 * 一句话模型:**每个用户最多一个上级(注册时带码绑定,一生一次,后台可改挂);
 * 下级付款时沿上级链逐级算佣金,先冻结(退款观察期),到期转可提现,推广人申请提现、后台审核打款;
 * 订单退款时同事务冲回佣金。**
 *
 * 与 tuiguang 根入口(单层、返金币)的区别:
 * - 多级:上级链存成数组(就近在前),一次查询拿到全部上级,不递归;
 * - 现金:佣金有账户(冻结 / 可提现 / 提现中 / 已提现),有提现单;
 * - 两种算法:逐级比例(level)与级差(differential,经销商体系常用);
 * - 身份分档:后台把人设成某个等级(分销商 / 经销商 / 总代 …),每档自己的逐级比例。
 *
 * 刻意的边界:
 * 1. 用户 id 是不透明字符串;包内不存昵称手机号,显示名由宿主投影。
 * 2. 金额一律 bigint,单位由宿主定(人民币分最常见),只做整数运算、向下取整。
 * 3. 规则(FxPolicy)由宿主的配置系统给,每次结算现取;默认值是「关」。
 * 4. 包不打款:提现单「已打款」只是记账,真实转账由财务在线下 / 支付平台完成。
 */
/** 佣金算法。level = 每一级按该上级自己的第 k 级比例;differential = 级差(上级拿自己总比例减下面已分走的) */
export type FxMode = "level" | "differential";
/** 分销等级(身份档)。rates[k] = 拿第 k+1 级下级付款的万分比;级差模式只看 rates[0](该档总比例) */
export interface FxTier {
    /** 稳定代码,小写字母数字与 - _(如 agent / dealer / gold) */
    code: string;
    /** 显示名(分销商 / 经销商 / 总代) */
    name: string;
    rates: number[];
}
export interface FxPolicy {
    /** 结算总开关。关着时付款不产生佣金,绑定关系照常记录 */
    enabled: boolean;
    mode: FxMode;
    /** 最多返几级(1~10)。级差模式同样只往上走这么多级 */
    maxLevels: number;
    /** true = 人人可推广(没等级的普通用户按 defaultRates 拿);false = 只有后台设了等级的人拿佣金 */
    openToAll: boolean;
    /** 普通用户(没等级)的逐级比例;openToAll=false 时不用 */
    defaultRates: number[];
    tiers: FxTier[];
    /** 一笔付款所有上级佣金合计不超过基数的这个万分比(护住毛利);10000 = 不限 */
    totalCapBps: number;
    /** 佣金冻结天数(退款观察期),到期才可提现;0 = 立即可提现 */
    freezeDays: number;
    /** 付款基数低于此值不返(挡小额刷单);0n = 不限 */
    minBaseAmount: bigint;
    /** 单次提现最低金额 */
    minWithdrawal: bigint;
}
export interface FxMember {
    userId: string;
    /** 直接上级;null = 没人推荐(或顶层) */
    parentUserId: string | null;
    /** 上级链,就近在前:[直接上级, 上级的上级, …],最长 MAX_CHAIN */
    ancestors: string[];
    /** 邀请码(大写字母数字,唯一);没领过 = null */
    code: string | null;
    /** 分销等级 code;null = 普通用户 */
    tierCode: string | null;
    /** false = 停用:不再拿佣金、邀请码失效;历史记录保留 */
    enabled: boolean;
    /** 逐人覆盖的逐级比例;null = 跟等级 / 默认 */
    rateOverride: number[] | null;
    note: string | null;
    boundAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export type FxCommissionStatus = "frozen" | "available" | "reversed";
export interface FxCommission {
    id: bigint;
    sourceKind: string;
    /** 来源引用(订单 id / 拆单组 id)。(sourceKind, sourceRef, beneficiaryUserId) 唯一 = 幂等锚 */
    sourceRef: string;
    buyerUserId: string;
    beneficiaryUserId: string;
    /** 第几级上级(1 = 直接上级) */
    level: number;
    baseAmount: bigint;
    rateBps: number;
    amount: bigint;
    status: FxCommissionStatus;
    availableAt: Date;
    reversedAt: Date | null;
    reverseReason: string | null;
    createdAt: Date;
}
export interface FxAccount {
    userId: string;
    /** 冻结中(观察期内) */
    frozen: bigint;
    /** 可提现;退款冲回已提走的佣金时可能为负(欠款,后续佣金先抵) */
    available: bigint;
    /** 已申请、待审核打款 */
    withdrawing: bigint;
    withdrawn: bigint;
    /** 累计产生(含后来冲回的) */
    earned: bigint;
    /** 累计冲回 */
    reversed: bigint;
}
export type FxWithdrawalStatus = "pending" | "paid" | "rejected";
export interface FxPayee {
    /** 收款方式:alipay / wechat / bank …(宿主定) */
    method: string;
    account: string;
    name: string;
}
export interface FxWithdrawal {
    id: bigint;
    userId: string;
    amount: bigint;
    status: FxWithdrawalStatus;
    payee: FxPayee;
    adminNote: string | null;
    reviewedBy: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
}
/** 结算时一位上级的输入:rates = 他能拿的逐级比例;null = 他这一档不拿钱(停用 / 普通用户且没开人人可推广) */
export interface FxChainLink {
    userId: string;
    rates: number[] | null;
}
export interface FxShare {
    userId: string;
    level: number;
    rateBps: number;
    amount: bigint;
}
export type FxBindResult = {
    bound: true;
    member: FxMember;
} | {
    bound: false;
    reason: "CODE_NOT_FOUND" | "INVITER_DISABLED" | "SELF_REFERRAL" | "ALREADY_BOUND";
};
export type FxSettleResult = {
    settled: true;
    commissions: FxCommission[];
} | {
    settled: false;
    reason: "DISABLED" | "NOT_REFERRED" | "BELOW_MIN" | "ZERO" | "DUPLICATE";
};
export type FxEvent = {
    type: "member.bound";
    member: FxMember;
} | {
    type: "commission.created";
    commissions: FxCommission[];
} | {
    type: "commission.reversed";
    sourceKind: string;
    sourceRef: string;
    count: number;
    amount: bigint;
} | {
    type: "withdrawal.requested";
    withdrawal: FxWithdrawal;
} | {
    type: "withdrawal.reviewed";
    withdrawal: FxWithdrawal;
};
export declare const FxErrorCodes: {
    readonly POLICY_INVALID: "FX_POLICY_INVALID";
    readonly NOT_FOUND: "FX_NOT_FOUND";
    readonly TIER_NOT_FOUND: "FX_TIER_NOT_FOUND";
    readonly CODE_TAKEN: "FX_CODE_TAKEN";
    readonly CODE_INVALID: "FX_CODE_INVALID";
    readonly NOT_ELIGIBLE: "FX_NOT_ELIGIBLE";
    readonly CYCLE: "FX_CYCLE";
    readonly AMOUNT_INVALID: "FX_AMOUNT_INVALID";
    readonly BELOW_MIN_WITHDRAWAL: "FX_BELOW_MIN_WITHDRAWAL";
    readonly INSUFFICIENT_BALANCE: "FX_INSUFFICIENT_BALANCE";
    readonly WITHDRAWAL_CLOSED: "FX_WITHDRAWAL_CLOSED";
};
export type FxErrorCode = (typeof FxErrorCodes)[keyof typeof FxErrorCodes];
/** 只给调用方错误(参数 / 状态不允许)用;绑定与结算不抛,返回结果对象 */
export declare class FenxiaoError extends Error {
    readonly code: FxErrorCode;
    constructor(code: FxErrorCode, message: string);
}