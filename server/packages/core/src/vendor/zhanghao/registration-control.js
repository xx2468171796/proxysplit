/**
 * zhanghao/registration-control —— 注册管控:总开关 / 每日名额 / 内测码 / 一机 N 号。
 *
 * 业主:「所有项目基本都会有内测(邀请码)、设备指纹(一机一号)、防批量小号,要通用化。」
 * 这套逻辑此前困在 6E 宿主(`packages/core/src/identity/registration-*.ts`,约 800 行),5ff / V7 / 5FD 又各写了一份。
 * 现在它是 handlers `verify.register` 钩子的一个实现:在人机验证、短信/邮箱码之后、`zh.register` 之前裁决;
 * 需要与建号同生共死的两步(占名额、扣码)返回成 `beforeCreate`,由 service 在**同一事务、建号之前**执行。
 *
 * 四道闸(顺序:总开关/内测码 → 名额 → 设备):
 *   ① 总开关 `enabled=false` = **只有内测码能进**(不是全关):无码 / 码无效 → REGISTRATION_CLOSED / BETA_CODE_INVALID。
 *   ② 内测码 `off / optional / required`:optional 给了就必须有效;required 没给也算无效。
 *      扣减在事务里且是**一条原子 UPDATE**(store 契约);这里事务外只做只读预检,好给用户一句能看懂的错。
 *   ③ 每日名额(自然日,默认 Asia/Shanghai):事务外只读预检,事务里 `reserveDailySlot` 才是权威 —— 满了整个注册回滚。
 *   ④ 一机 N 号:按 `registerMeta.fingerprint` 计数;`block` 超限拒,`flag` 放行但 `registerMeta.deviceOverLimit=true`
 *      (宿主 afterCreate 据此不发注册礼包 —— 6E 的 no_gift 就是这个)。**缺指纹放行**(软闸):隐私模式 / 明文页拿不到指纹,
 *      拒了等于把真人挡在门外;要硬闸让前端不带指纹就不许提交。
 *
 * 策略本体**不在包里存**(宿主有自己的配置系统),包只每次读 `policy()` —— 别在闭包里缓存,运营改完看不到变化且不报错。
 * store 没实现某一闸的方法而策略开了它 → 抛 STORE_UNAVAILABLE(fail closed):放行等于「后台一开内测码,注册口照样裸奔」。
 */
import { createHash } from "node:crypto";
import { ZhanghaoError } from "./types.js";
/** 全开:与不接本模块时行为相同。宿主配置缺省时用它,别自己再抄一份默认值 */
export const OPEN_REGISTRATION_POLICY = {
    enabled: true,
    dailyLimit: null,
    betaCode: "off",
    device: { limit: null, action: "flag" },
};
/* ────────────────────────────── 归一 / 时间 ────────────────────────────── */
/** 内测码大小写不敏感靠**入库前统一大写**,不靠查询时 lower()(后者会让唯一索引形同虚设) */
export function normalizeBetaCode(raw) {
    return (raw ?? "").trim().toUpperCase();
}
/** 只认 64 位小写 hex(sha-256 形状);别的形状当没送(缺指纹 = 放行,所以要防客户端送个 "1" 来占位) */
export function normalizeFingerprint(raw) {
    return typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}
const MAX_BATCH = 200;
const MAX_LIST = 200;
const DEFAULT_LIST = 50;
/** 无 0/O/1/I 的 base32 字母表:运营口头报码不会念错 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function zonedParts(at, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
    const get = (type) => Number(fmt.formatToParts(at).find((p) => p.type === type)?.value ?? "0");
    return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}
/** 某时区下的自然日键 */
export function dayKeyIn(at, timeZone) {
    const p = zonedParts(at, timeZone);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
/**
 * 某时区下「下一个自然日 00:00」对应的 UTC 时刻。
 * 用「格式化出来的墙钟 − 真实时刻」反推该时区此刻的偏移,再把次日零点减回去;
 * 无夏令时的时区(Asia/Shanghai)精确,有夏令时的时区在切换日可能偏一小时 —— 这里只用于展示 resetAt,不参与判闸。
 */
export function nextDayStartIn(at, timeZone) {
    const p = zonedParts(at, timeZone);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    const offsetMs = wall - Math.floor(at.getTime() / 1000) * 1000;
    return new Date(Date.UTC(p.y, p.m - 1, p.d + 1) - offsetMs);
}
/** 从 requestId 确定性派生第 i 个码:同 requestId 重放得到同一批,撞唯一索引即幂等 */
export function deriveBetaCode(seed, index, length, prefix = "") {
    const digest = createHash("sha256").update(`${seed}:${index}`).digest();
    let out = "";
    // 下标对 digest.length 取模,必在界内;原来的 `!` 只骗类型,这里同样只做类型断言
    for (let i = 0; i < length; i += 1)
        out += CODE_ALPHABET[digest[i % digest.length] % CODE_ALPHABET.length];
    return normalizeBetaCode(prefix + out);
}
function usableOf(row, now) {
    return row.enabled && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime()) && (row.maxUses === null || row.usedCount < row.maxUses);
}
function unavailable(what) {
    throw new ZhanghaoError("STORE_UNAVAILABLE", `注册管控:store 未实现${what},策略却开了它(fail closed)`, { capability: what });
}
/**
 * 能力在工厂里已按 typeof === "function" 判过、未实现时 unavailable 已经抛了;
 * 万一调用时方法又被拿掉,与原来的 `store.x!()` 一样抛 TypeError(不换成别的错误码)。
 */
function missingMethod(name) {
    throw new TypeError(`store.${name} is not a function`);
}
function betaInvalid(reason) {
    // 四种情况同一句话:不让人靠错误码探出「这个码存在但已用完」
    throw new ZhanghaoError("BETA_CODE_INVALID", "内测码无效", { reason });
}
const withUsable = (row, at) => ({ ...row, usable: usableOf(row, at) });
function requireRequestId(ctx) {
    if (!ctx.requestId?.trim())
        throw new ZhanghaoError("VALIDATION", "后台动作必须带 requestId(幂等锚)", { field: "requestId" });
}
async function readPolicyOf(opts) {
    const p = await opts.policy();
    // 只做形状兜底,不做业务默认:缺字段按「全开」补 —— 宿主配置系统缺半段不该让注册口整个关死
    return {
        enabled: p.enabled !== false,
        dailyLimit: typeof p.dailyLimit === "number" && p.dailyLimit >= 0 ? Math.floor(p.dailyLimit) : null,
        betaCode: p.betaCode === "optional" || p.betaCode === "required" ? p.betaCode : "off",
        device: {
            limit: typeof p.device?.limit === "number" && p.device.limit >= 0 ? Math.floor(p.device.limit) : null,
            action: p.device?.action === "block" ? "block" : "flag",
        },
    };
}
function verifyRegisterFor(c) {
    const { store, timeZone, now, supports, readPolicy } = c;
    return async function verifyRegister(ctx) {
        const policy = await readPolicy();
        const at = now();
        const registerMeta = {};
        const steps = [];
        /* ① 总开关 + ② 内测码:门关着时内测码是唯一入口,等价于 required */
        const mode = policy.enabled ? policy.betaCode : "required";
        const code = normalizeBetaCode(ctx.betaCode);
        if (mode !== "off") {
            if (!code) {
                if (!policy.enabled)
                    throw new ZhanghaoError("REGISTRATION_CLOSED", "当前为内测阶段,请输入内测码", { reason: "beta_code_required" });
                if (mode === "required")
                    betaInvalid("missing");
            }
            else {
                if (!supports.betaCodes)
                    unavailable("内测码(findBetaCode / consumeBetaCode)");
                // 只读预检:给用户一句能看懂的错。真正的扣减在下面的 beforeCreate(同事务、原子)
                const row = await (store.findBetaCode ? store.findBetaCode(code) : missingMethod("findBetaCode"));
                if (!row || !usableOf(row, at))
                    betaInvalid(!row ? "not_found" : !row.enabled ? "disabled" : row.expiresAt !== null && row.expiresAt.getTime() <= at.getTime() ? "expired" : "exhausted");
                registerMeta.betaCode = code;
                steps.push(async (tx) => {
                    // 中间可能被别人用掉最后一次:预检通过不代表这里一定通过;失败 = 整个注册回滚
                    if (!(await (store.consumeBetaCode ? store.consumeBetaCode(code, tx) : missingMethod("consumeBetaCode"))))
                        betaInvalid("exhausted");
                });
            }
        }
        /* ③ 每日名额:预检只为早拒,事务内 reserveDailySlot 才是权威 */
        if (policy.dailyLimit !== null) {
            if (!supports.dailyLimit)
                unavailable("每日名额(reserveDailySlot)");
            const limit = policy.dailyLimit;
            const dayKey = dayKeyIn(at, timeZone);
            const full = () => new ZhanghaoError("REGISTRATION_FULL", `今日注册名额已满(每日限量 ${limit} 人),请明天再试`, {
                dailyLimit: limit,
                remaining: 0,
                resetAt: nextDayStartIn(at, timeZone).toISOString(),
            });
            if (store.dailyUsed && (await store.dailyUsed(dayKey)) >= limit)
                throw full();
            steps.push(async (tx) => {
                if (!(await (store.reserveDailySlot ? store.reserveDailySlot(dayKey, limit, tx) : missingMethod("reserveDailySlot"))))
                    throw full();
            });
        }
        /* ④ 一机 N 号:缺指纹放行(软闸);超限 block 拒 / flag 标记 */
        if (ctx.fingerprint) {
            registerMeta.fingerprint = ctx.fingerprint;
            if (policy.device.limit !== null) {
                if (!supports.device)
                    unavailable("设备指纹计数(countByRegisterFingerprint)");
                const count = await (store.countByRegisterFingerprint ? store.countByRegisterFingerprint(ctx.fingerprint) : missingMethod("countByRegisterFingerprint"));
                registerMeta.deviceAccountCount = count;
                if (count >= policy.device.limit) {
                    if (policy.device.action === "block") {
                        throw new ZhanghaoError("DEVICE_LIMIT", policy.device.limit <= 1 ? "一台设备仅限注册一个账号" : `一台设备最多注册 ${policy.device.limit} 个账号`, { limit: policy.device.limit, count });
                    }
                    registerMeta.deviceOverLimit = true;
                }
            }
        }
        const decision = { registerMeta };
        if (steps.length > 0) {
            decision.beforeCreate = async (tx) => {
                for (const step of steps)
                    await step(tx);
            };
        }
        return decision;
    };
}
function adminFor(c) {
    const { store, now, codeLength } = c;
    return {
        async listBetaCodes(filter) {
            if (!store.listBetaCodes)
                unavailable("内测码列表(listBetaCodes)");
            const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_LIST), MAX_LIST);
            const f = { limit };
            if (filter.query?.trim())
                f.query = normalizeBetaCode(filter.query);
            if (filter.status && filter.status !== "all")
                f.status = filter.status;
            if (filter.beforeId)
                f.beforeId = filter.beforeId;
            const at = now();
            return (await store.listBetaCodes(f)).map((r) => withUsable(r, at));
        },
        async createBetaCodes(input, ctx) {
            if (!store.insertBetaCodes)
                unavailable("批量建码(insertBetaCodes)");
            requireRequestId(ctx);
            let codes;
            if (input.codes && input.codes.length > 0) {
                codes = input.codes.map(normalizeBetaCode).filter(Boolean);
                if (codes.length !== input.codes.length)
                    throw new ZhanghaoError("VALIDATION", "内测码不能为空串", { field: "codes" });
                if (new Set(codes).size !== codes.length)
                    throw new ZhanghaoError("VALIDATION", "内测码列表里有重复(大小写不敏感)", { field: "codes" });
            }
            else {
                const count = input.count ?? 0;
                if (!Number.isInteger(count) || count < 1)
                    throw new ZhanghaoError("VALIDATION", "codes 与 count 至少给一个,count 须为正整数", { field: "count" });
                codes = Array.from({ length: count }, (_, i) => deriveBetaCode(ctx.requestId, i, codeLength, input.prefix ?? ""));
            }
            if (codes.length > MAX_BATCH)
                throw new ZhanghaoError("VALIDATION", `一次最多登记 ${MAX_BATCH} 个内测码`, { field: "codes", max: MAX_BATCH });
            if (input.maxUses !== undefined && input.maxUses !== null && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) {
                throw new ZhanghaoError("VALIDATION", "maxUses 须为正整数或 null(不限)", { field: "maxUses" });
            }
            const rows = codes.map((code) => ({ code, note: input.note ?? "", maxUses: input.maxUses ?? null, expiresAt: input.expiresAt ?? null }));
            const at = now();
            const created = (await store.insertBetaCodes(rows, ctx.operatorId)).map((r) => withUsable(r, at));
            const got = new Set(created.map((r) => r.code));
            return { created, existing: codes.filter((c) => !got.has(c)) };
        },
        async updateBetaCode(id, patch, ctx) {
            if (!store.updateBetaCode)
                unavailable("改码(updateBetaCode)");
            requireRequestId(ctx);
            if (patch.maxUses !== undefined && patch.maxUses !== null && (!Number.isInteger(patch.maxUses) || patch.maxUses < 1)) {
                throw new ZhanghaoError("VALIDATION", "maxUses 须为正整数或 null(不限)", { field: "maxUses" });
            }
            const row = await store.updateBetaCode(id, patch);
            return row ? withUsable(row, now()) : null;
        },
    };
}
export function createRegistrationControl(opts) {
    const { store } = opts;
    const timeZone = opts.timeZone ?? "Asia/Shanghai";
    const now = opts.now ?? (() => new Date());
    const codeLength = opts.codeLength ?? 8;
    const supports = {
        betaCodes: typeof store.findBetaCode === "function" && typeof store.consumeBetaCode === "function",
        dailyLimit: typeof store.reserveDailySlot === "function",
        device: typeof store.countByRegisterFingerprint === "function",
    };
    const readPolicy = () => readPolicyOf(opts);
    async function status() {
        const policy = await readPolicy();
        const at = now();
        const dayKey = dayKeyIn(at, timeZone);
        const used = policy.dailyLimit !== null && store.dailyUsed ? await store.dailyUsed(dayKey) : null;
        return {
            policy,
            dayKey,
            resetAt: nextDayStartIn(at, timeZone),
            dailyUsed: used,
            dailyRemaining: used === null || policy.dailyLimit === null ? null : Math.max(0, policy.dailyLimit - used),
            storeSupports: { ...supports },
        };
    }
    const c = { store, timeZone, now, codeLength, supports, readPolicy };
    return {
        verifyRegister: verifyRegisterFor(c),
        policy: readPolicy,
        dayKey: (at = now()) => dayKeyIn(at, timeZone),
        status,
        admin: adminFor(c),
    };
}
