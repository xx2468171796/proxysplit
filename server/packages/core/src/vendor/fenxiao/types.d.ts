/**
 * fenxiao(多级分销)域类型。
 *
 * 一句话模型:**每个用户最多一个上级(注册时带码绑定,一生一次,后台可改挂);
 * 下级付款时沿上级链逐级算佣金,先冻结(退款观察期),到期转可提现,推广人申请提现、后台审核打款;
 * 订单退款时同事务冲回佣金。**
 *
 * 刻意的边界:
 * 1. 用户 id 是不透明字符串;包内不存昵称手机号,显示名由宿主投影。
 * 2. 金额一律 bigint,单位由宿主定(人民币分最常见),只做整数运算、向下取整。
 * 3. 规则(FxPolicy)由宿主的配置系统给,每次结算现取;默认值是「关」。
 * 4. 包不打款:提现单「已打款」只是记账,真实转账由财务在线下 / 支付平台完成。
 * 5. 合规:默认最多返 2 级,超过 3 级必须显式 allowDeepLevels(国内「三级及以上」有传销风险,见 INTEGRATION.md)。
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
/** 按商品 / 套餐的规则:excluded = 这类不返佣;multiplierBps = 在正常比例上再乘(5000 = 减半,10000 = 不变) */
export interface FxProductRule {
    /** 宿主的商品 / 套餐 / 订单类型代码(结算时传 productKey) */
    key: string;
    excluded?: boolean;
    multiplierBps?: number;
}
/** 复购限制(订阅续费常用):maxOrders = 每个买家最多给上级返几单(0 = 不限);withinDays = 绑定后多少天内的付款才返(0 = 不限) */
export interface FxRecurring {
    maxOrders: number;
    withinDays: number;
}
/** 申请成为推广员:off = 只有后台指定;review = 用户申请、后台审;auto = 申请即通过 */
export type FxApplicationMode = "off" | "review" | "auto";
export interface FxPolicy {
    /** 结算总开关。关着时付款不产生佣金,绑定关系照常记录 */
    enabled: boolean;
    mode: FxMode;
    /** 最多返几级。默认上限 3;allowDeepLevels=true 才能到 10 */
    maxLevels: number;
    /** 显式确认要 3 级以上(合规自负) */
    allowDeepLevels: boolean;
    /** true = 人人可推广(没等级的普通用户按 defaultRates 拿);false = 只有设了等级的人拿佣金 */
    openToAll: boolean;
    /** 普通用户(没等级)的逐级比例;openToAll=false 时不用 */
    defaultRates: number[];
    tiers: FxTier[];
    /** 一笔付款所有上级佣金合计不超过基数的这个万分比(护住毛利);10000 = 不限 */
    totalCapBps: number;
    /** 佣金冻结天数(退款观察期,建议 ≥ 退款窗口),到期才可提现;0 = 立即可提现 */
    freezeDays: number;
    /** 付款基数低于此值不返(挡小额刷单);0n = 不限 */
    minBaseAmount: bigint;
    /** 基数高于此值的佣金先挂起待人工复核(风控);0n = 不挂 */
    holdAbove: bigint;
    products: FxProductRule[];
    recurring: FxRecurring;
    application: FxApplicationMode;
    /** 申请通过后给的等级 code;null = 只开人人可推广的默认比例 */
    applicationTierCode: string | null;
    /** 单次提现最低金额 */
    minWithdrawal: bigint;
    /** 提现手续费:按比例(万分比)+ 固定额,从提现金额里扣,打款按实付 */
    withdrawalFeeBps: number;
    withdrawalFeeFixed: bigint;
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
/** held = 风控挂起待复核(不进冻结、不可提现);reversed = 退款冲回或复核作废 */
export type FxCommissionStatus = "frozen" | "available" | "held" | "reversed";
export interface FxCommission {
    id: bigint;
    /** order = 付款结算;adjust = 后台手工调账;宿主可自定其它种类 */
    sourceKind: string;
    /** 来源引用(订单 id / 拆单组 id / 调账单号)。(sourceKind, sourceRef, beneficiaryUserId) 唯一 = 幂等锚 */
    sourceRef: string;
    buyerUserId: string;
    beneficiaryUserId: string;
    /** 第几级上级(1 = 直接上级;调账为 0) */
    level: number;
    baseAmount: bigint;
    rateBps: number;
    /** 调账可为负 */
    amount: bigint;
    status: FxCommissionStatus;
    productKey: string | null;
    availableAt: Date;
    holdReason: string | null;
    reversedAt: Date | null;
    reverseReason: string | null;
    note: string | null;
    createdAt: Date;
}
export interface FxAccount {
    userId: string;
    /** 冻结中(观察期内) */
    frozen: bigint;
    /** 风控挂起待复核 */
    held: bigint;
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
    /** 申请金额(从可提现扣) */
    amount: bigint;
    /** 手续费;实付 = amount - fee */
    fee: bigint;
    net: bigint;
    status: FxWithdrawalStatus;
    payee: FxPayee;
    adminNote: string | null;
    reviewedBy: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
}
export type FxApplicationStatus = "pending" | "approved" | "rejected";
export interface FxApplication {
    id: bigint;
    userId: string;
    status: FxApplicationStatus;
    message: string | null;
    adminNote: string | null;
    reviewedBy: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
}
export interface FxAuditEntry {
    id: bigint;
    actorId: string;
    action: string;
    targetUserId: string | null;
    detail: Record<string, unknown>;
    createdAt: Date;
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
export type FxSkipReason = "DISABLED" | "NOT_REFERRED" | "BELOW_MIN" | "EXCLUDED" | "RECURRING_LIMIT" | "ZERO" | "DUPLICATE" | "REVERSED";
export type FxSettleResult = {
    settled: true;
    commissions: FxCommission[];
} | {
    settled: false;
    reason: FxSkipReason;
};
/** 一份金额变动:谁、多少 */
export interface FxAmountItem {
    userId: string;
    amount: bigint;
}
export type FxEvent = {
    type: "member.bound";
    member: FxMember;
} | {
    type: "member.updated";
    member: FxMember;
    action: "set" | "move";
    operatorId: string;
} | {
    type: "application.created";
    application: FxApplication;
} | {
    type: "application.reviewed";
    application: FxApplication;
} | {
    type: "commission.created";
    commissions: FxCommission[];
} | {
    type: "commission.released";
    items: FxAmountItem[];
} | {
    type: "commission.reversed";
    sourceKind: string;
    sourceRef: string;
    reason: string;
    items: FxAmountItem[];
    amount: bigint;
} | {
    type: "commission.reviewed";
    commission: FxCommission;
    action: "approve" | "void";
    operatorId: string;
} | {
    type: "commission.adjusted";
    commission: FxCommission;
    operatorId: string;
} | {
    type: "withdrawal.requested";
    withdrawal: FxWithdrawal;
} | {
    type: "withdrawal.reviewed";
    withdrawal: FxWithdrawal;
};
export declare const FxErrorCodes: {
    readonly POLICY_INVALID: "FX_POLICY_INVALID";
    readonly INPUT_INVALID: "FX_INPUT_INVALID";
    readonly NOT_FOUND: "FX_NOT_FOUND";
    readonly TIER_NOT_FOUND: "FX_TIER_NOT_FOUND";
    readonly CODE_TAKEN: "FX_CODE_TAKEN";
    readonly CODE_INVALID: "FX_CODE_INVALID";
    readonly NOT_ELIGIBLE: "FX_NOT_ELIGIBLE";
    readonly CYCLE: "FX_CYCLE";
    readonly AMOUNT_INVALID: "FX_AMOUNT_INVALID";
    readonly BELOW_MIN_WITHDRAWAL: "FX_BELOW_MIN_WITHDRAWAL";
    readonly INSUFFICIENT_BALANCE: "FX_INSUFFICIENT_BALANCE";
    readonly ALREADY_CLOSED: "FX_ALREADY_CLOSED";
    readonly APPLICATION_CLOSED: "FX_APPLICATION_CLOSED";
};
export type FxErrorCode = (typeof FxErrorCodes)[keyof typeof FxErrorCodes];
/** 只给调用方错误(参数 / 状态不允许)用;绑定与结算不抛,返回结果对象 */
export declare class FenxiaoError extends Error {
    readonly code: FxErrorCode;
    constructor(code: FxErrorCode, message: string);
}
/** 宿主事务:传 tx 就在宿主事务里跑;afterCommit 让通知 / 推送等宿主提交后再发 */
export interface FxTxInput<Q> {
    tx?: Q;
    afterCommit?: (run: () => Promise<void>) => void;
}