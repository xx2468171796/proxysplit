/**
 * 各模块共用的底座:依赖包、事务里跑并在提交后发事件、账户加减、审计落库。
 */
import { type FxQueryable, type FxTables } from "./sql.ts";
import type { FxAccount, FxEvent, FxPolicy, FxTxInput } from "./types.ts";
/** 风控检查:返回挂起原因(字符串)= 这笔佣金先挂起待人工复核;null = 放行 */
export type FxRiskCheck = (ctx: {
    buyerUserId: string;
    beneficiaryUserIds: string[];
    baseAmount: bigint;
    sourceKind: string;
    sourceRef: string;
    productKey: string | null;
    tx: FxQueryable;
}) => string | null | Promise<string | null>;
export interface Deps {
    db: FxQueryable;
    t: FxTables;
    /** 现取规则;传 q = 在这个事务句柄上读(事务里别另借连接,池子满时会互等死锁) */
    policy: (q?: FxQueryable) => Promise<FxPolicy>;
    now: () => Date;
    /** 提交后才调;出错只记日志 */
    dispatch: (events: FxEvent[]) => Promise<void>;
    risk: FxRiskCheck | undefined;
}
/**
 * 在事务里跑 fn,fn 往 events 里放事件:
 * - 宿主传了 tx + afterCommit → 宿主提交后发;
 * - 宿主传了 tx 没给 afterCommit → fn 跑完立刻发(宿主事务可能还会回滚,接入手册里写明);
 * - 包自己开的事务 → 提交后发。
 */
export declare function run<T>(d: Deps, io: FxTxInput<FxQueryable>, fn: (q: FxQueryable, events: FxEvent[]) => Promise<T>): Promise<T>;
export type AccountDelta = Partial<Record<keyof Omit<FxAccount, "userId">, bigint>>;
/** 账户加减:一行 upsert,行锁顺带拿到。多人时调用方按 user id 升序调(全包同序,不互相死锁) */
export declare function bump(q: FxQueryable, t: FxTables, userId: string, deltas: AccountDelta): Promise<void>;
/** 后台操作留痕(和业务同事务写,回滚一起回滚) */
export declare function audit(q: FxQueryable, d: Deps, e: {
    actorId: string;
    action: string;
    targetUserId: string | null;
    detail: Record<string, unknown>;
}): Promise<void>;
/** 加锁顺序用的比较:按码点比,不受系统区域 / ICU 影响(多实例必须同序,否则互相死锁) */
export declare const cmp: (a: string, b: string) => number;