/**
 * `createSiteOtp` —— 站点侧「中心验证码」的唯一实现(2.29.0;收编 huiyuan / v7 / 5ff 的 center-otp 与 5ffcg / 5eplay / gx / to2cs2 的同类逻辑)。
 *
 * 前端协议不变(仍是 号/邮箱 + 码):站点只记「这个对象 + 用途当前的 verificationId」(站点 KV,≤ 5 分钟)。
 * - 只读校验(peek,consume:false):中心核对即作废码,所以核对成功后把结果票据按「通道 + 用途 + 对象 + 码的哈希」暂存,
 *   存活时间 = min(peekTtlSec, 票据自身剩余寿命)(票过期了暂存也没用,不能比票活得久);随后真正消费时拿同一个码换回票据并在线核销(jti 一次性)。
 *   暂存期内错码计数,达到 maxPeekMisses 丢票据(中心那边的尝试次数已不再起作用)。
 * - 人机票在所有分支都先核销:refuse(拒发原因,如「号已占用」)命中时不发码,但仍核同一张票(否则拒发分支是零成本号码探测器)。
 * - 防枚举:`sendIfExists` 已注册 / 未注册对外同一句话 + 同样耗时;只有人机票错误和中心不可用照实返回(两条路都会这样报)。
 * - 故障方向:发码 / 核码 / 只核人机票一律 fail-closed(中心不可用或本站没配好 → busy)。
 * 已知取舍:同一对象再发一次会顶掉上一条 verificationId(只能骚扰,拿不到账号;中心按号限额兜底)。
 */
import { createHash, createHmac } from "node:crypto";
import { parseStash, withMinDuration } from "./site-otp-util.js";
export const DEFAULT_OTP_MESSAGES = {
    busy: "验证服务繁忙，请稍后再试",
    captcha: "安全验证未通过或已过期，请重新完成验证",
    sent: "验证码已发送，5 分钟内有效",
    noCode: "请先获取验证码",
    wrong: "验证码错误",
    wrongLeft: "验证码错误，还可以试 {n} 次",
    expired: "验证码已失效，请重新获取",
    format: "验证码格式不正确",
};
const VID_TTL_SEC = 300;
const LABEL = { sms: "短信", email: "邮件" };
function reasonOf(r) {
    return r.status === "unavailable" ? r.reason : r.status === "rejected" ? r.error : "ok";
}
export { withMinDuration };
// biome-ignore lint/suspicious/noConsole: 默认日志去 console(与收编前各站一致),站点可传 log 换掉
const consoleLog = (level, msg, meta) => console[level](`[site-otp] ${msg}`, meta ?? "");
const key = (c, kind, s) => (s.intent ? `${c.o.keyPrefix}${kind}:i:${s.intent}` : `${c.o.keyPrefix}${kind}:${s.ch}:${s.purpose}:${s.to}`);
function codeHash(c, s, code) {
    // 不带 intent 时与 2.29 的格式一致(升级瞬间在途的暂存不失效);带了 intent 才多拼一段
    const msg = s.intent ? `${s.ch}|${s.purpose}|${s.to}|${s.intent}|${code}` : `${s.ch}|${s.purpose}|${s.to}|${code}`;
    return c.o.stashSecret ? createHmac("sha256", c.o.stashSecret).update(msg).digest("hex") : createHash("sha256").update(msg).digest("hex");
}
const busy = (c) => ({ ok: false, code: "busy", message: c.m.busy, sendFailed: true, busy: true });
const captchaBad = (c) => ({ ok: false, code: "captcha", message: c.m.captcha, captchaFailed: true });
const fail = (code, message) => ({ ok: false, code, message });
const PASSED = { ok: true, code: "ok", message: "" };
async function outage(c, channel) {
    try {
        await c.o.onOutage?.(channel);
    }
    catch {
        /* 降级阀记不上不影响本次结果 */
    }
}
async function kvOrNull(c) {
    try {
        return await c.o.kv();
    }
    catch {
        return null;
    }
}
function sendError(c, channel, error, body) {
    switch (error) {
        case "COOLDOWN": {
            const s = Number(body.resendAfter) || 60;
            return { ok: false, code: "cooldown", message: `发送太频繁，请 ${s} 秒后再试`, retryAfterSec: s };
        }
        case "QUOTA_EXCEEDED":
            return { ok: false, code: "quota", message: "今日验证码发送次数已达上限，请明天再试", budgetExhausted: true };
        case "CAPTCHA_REQUIRED":
        case "CAPTCHA_INVALID":
            return captchaBad(c);
        case "BLOCKED_PREFIX":
            return { ok: false, code: "blocked-prefix", message: "暂不支持该号段，请换一个手机号" };
        case "BAD_RECIPIENT":
            return { ok: false, code: "bad-recipient", message: channel === "sms" ? "手机号格式不正确" : "邮箱格式不正确" };
        default:
            return { ok: false, code: "send-failed", message: `${LABEL[channel]}发送失败，请稍后再试`, sendFailed: true };
    }
}
/**
 * 豁免只在「只给了豁免一个字段 + 用途在本站 exemptPurposes 里」时成立(运行时也查:防调用方把玩家 body 摊进来)。
 * 其余带了 captchaExempt 的一律当没过人机。
 */
function exemptOk(c, p, purpose) {
    return p.captchaExempt === true && p.captchaTicket === undefined && p.captchaVerification === undefined && (c.o.exemptPurposes ?? []).includes(purpose);
}
/** 凭证无效(没过人机):豁免不成立,或票 / 通行是空串 */
function proofMissing(c, p, purpose) {
    if (p.captchaExempt !== undefined)
        return !exemptOk(c, p, purpose);
    return !(p.captchaTicket || p.captchaVerification);
}
/** 只核人机凭证,不发码:LcVerify 票走 captcha.verify(action=sms),AJ 通行走 aj.verify(account),豁免(已过 exemptOk)直接过 */
async function proofOnly(c, p, remoteIp, purpose) {
    if (p.captchaExempt !== undefined)
        return exemptOk(c, p, purpose) ? { ok: true, code: "sent", message: "" } : captchaBad(c);
    if (p.captchaVerification)
        return ajOnly(c, p.captchaVerification);
    return captchaOnly(c, p.captchaTicket ?? "", remoteIp);
}
async function ajOnly(c, cv) {
    const cl = c.o.client();
    if (!cl) {
        c.log("error", "中心验证码已开启但本站凭据 / 域名未配");
        return busy(c);
    }
    const r = await cl.aj.verify({ captchaVerification: cv, action: "account" });
    if (r.status === "ok" && r.body.success === true)
        return { ok: true, code: "sent", message: "" };
    if (r.status === "unavailable") {
        c.log("warn", "aj verify unavailable, fail-closed", { reason: reasonOf(r) });
        return busy(c);
    }
    return captchaBad(c);
}
/** 只核人机票(action=sms,邮件也用 sms),不发码 */
async function captchaOnly(c, token, remoteIp) {
    const cl = c.o.client();
    if (!cl) {
        c.log("error", "中心验证码已开启但本站凭据 / 域名未配");
        return busy(c);
    }
    if (!token)
        return captchaBad(c);
    const r = await cl.captcha.verify({ token, action: "sms", ...(remoteIp ? { remoteIp } : {}) });
    // 严格:只有中心明确 success 才算过;不可用一律拒(不看下发的 failClosed)
    if (r.status === "ok" && r.body.success === true)
        return { ok: true, code: "sent", message: "" };
    if (r.status === "unavailable") {
        c.log("warn", "captcha verify unavailable, fail-closed", { reason: reasonOf(r) });
        return busy(c);
    }
    return captchaBad(c);
}
const slotOf = (i) => ({ ch: i.channel, purpose: i.purpose, to: i.to, intent: i.intent });
function proofFields(p) {
    if (p.captchaExempt === true)
        return { captchaExempt: true };
    if (p.captchaVerification)
        return { captchaVerification: p.captchaVerification };
    return { captchaTicket: p.captchaTicket ?? "" };
}
async function sendOutcome(c, kv, i, r) {
    if (r.status === "ok") {
        try {
            const s = slotOf(i);
            await kv.set(key(c, "vid", s), r.body.verificationId, Math.min(r.body.expiresIn || VID_TTL_SEC, VID_TTL_SEC));
            await kv.del(key(c, "ok", s));
            await kv.del(key(c, "miss", s));
        }
        catch (e) {
            c.log("error", "verificationId 记不进 KV(码已发出,玩家需重发)", { error: String(e) });
            return busy(c);
        }
        return { ok: true, code: "sent", message: c.m.sent, retryAfterSec: r.body.resendAfter };
    }
    if (r.status === "rejected") {
        c.log("warn", "send rejected", { channel: i.channel, purpose: i.purpose, error: r.error });
        if (r.error === "CHANNEL_NOT_CONFIGURED")
            await outage(c, i.channel);
        const body = r.body;
        return { ...sendError(c, i.channel, r.error, body), centerError: r.error, ...(typeof body.bucket === "string" ? { bucket: body.bucket } : {}) };
    }
    c.log("warn", "send unavailable, fail-closed", { channel: i.channel, purpose: i.purpose, reason: r.reason });
    await outage(c, i.channel);
    return { ...busy(c), reason: "center-unavailable" };
}
/**
 * 发码。refuse 返回拒发原因(如「该号已被占用」)时不发码,但仍先核同一张人机票;
 * 票不过照实报票的错,票过了才报 refuse 的原因(code=refused)。
 */
async function send(c, i, refuse) {
    const cl = c.o.client();
    const kv = await kvOrNull(c);
    if (!cl || !kv) {
        c.log("error", "中心客户端或 KV 不可用", { client: Boolean(cl), kv: Boolean(kv) });
        return busy(c);
    }
    if (proofMissing(c, i, i.purpose))
        return captchaBad(c);
    const why = refuse ? await refuse() : null;
    if (why) {
        const g = await proofOnly(c, i, i.clientIp, i.purpose);
        return g.ok ? { ok: false, code: "refused", message: why } : g;
    }
    const r = await cl.otp.send({
        purpose: i.purpose,
        channel: i.channel,
        to: i.to,
        clientIp: i.clientIp,
        ...(i.deviceFp ? { deviceFp: i.deviceFp } : {}),
        ...proofFields(i),
    });
    return sendOutcome(c, kv, i, r);
}
/**
 * 防枚举发码(找回密码等):exists() 为假只核人机票不发码;两条路对外都回 generic(ok)并至少耗时 minMs。
 * 只有人机票被拒 / 中心不可用照实返回(两条路都会这样报)。冷却 / 限额 / 发送失败 / 发出后 KV 写失败只记日志,对外仍报 generic(否则泄露已注册)。
 * minMs 必须大于一次真实发码耗时(SDK 单次超时 2 秒 → 建议 ≥ 2500),否则已注册那条可被计时区分。
 * 已知残留:中心只挂 otp/send 而 captcha/verify 正常这种「半挂」时,已注册的号报 busy、未注册报 generic(同一进程,极少见)。
 */
function sendIfExists(c, i, exists, opts) {
    return withMinDuration(async () => {
        const ok = { ok: true, code: "sent", message: opts.generic };
        // 两条路共同的前置条件先查:KV / 客户端缺了两条路都 busy(否则只有已注册那条会因 KV 故障报 busy)
        if (!c.o.client() || !(await kvOrNull(c)))
            return busy(c);
        if (proofMissing(c, i, i.purpose))
            return captchaBad(c);
        const r = (await exists()) ? publicSendResult(c, i, await send(c, i)) : await proofOnly(c, i, i.clientIp, i.purpose);
        return r.ok ? ok : r;
    }, opts.minMs);
}
/** 已注册那条的结局对外化:只有人机票错 / 中心整体不可用照实报(未注册那条也会这样报),其余按成功(只记日志) */
function publicSendResult(c, i, r) {
    if (r.ok || r.captchaFailed || r.reason === "center-unavailable")
        return r;
    c.log("warn", "enumeration-safe send not delivered", { purpose: i.purpose, code: r.code });
    return { ok: true, code: "sent", message: "" };
}
async function redeem(c, cl, token, ch, purpose, to) {
    const t = await cl.ticket.verify(token, { typ: "otp", purpose, subject: { channel: ch, value: to } });
    if (t.ok)
        return PASSED;
    return t.reason === "unavailable" ? fail("busy", c.m.busy) : fail("expired", c.m.expired);
}
/** 暂存秒数 = min(peekTtl, 票据剩余寿命);票验不过(或已过期)返回 0 = 不暂存;JWKS 拉不到返回 null(busy) */
async function stashTtl(c, cl, token, ch, purpose, to) {
    const t = await cl.ticket.verify(token, { typ: "otp", purpose, subject: { channel: ch, value: to }, online: false });
    if (!t.ok)
        return t.reason === "unavailable" ? null : 0;
    if (!Number.isFinite(t.payload.exp))
        return 0;
    return Math.min(c.peekTtl, Math.floor(t.payload.exp - c.now() / 1000));
}
async function putStash(c, a, h, token, ttl) {
    await a.kv.set(key(c, "ok", a), JSON.stringify({ h, t: token }), ttl);
    await a.kv.del(key(c, "miss", a));
}
/**
 * 先看暂存:命中 → 结果;码不对 → "miss"(够数丢票据);没暂存 → null。
 * 🔴 先占名额再比对(原子 incr 在前):以前「先比、错了才计数」,并发 N 个猜测全都比完,第 3 次 incr 才删暂存,
 * 3 次上限实际是 N 次(暂存最长活 600 秒,够把 6 位码扫掉一大片)。现在超出名额的请求不比对、直接作废暂存;
 * 命中则清计数(玩家自己输错两次再输对,不该吃掉后面只读校验的名额)。
 */
async function checkStash(c, a, h) {
    const okKey = key(c, "ok", a);
    const stash = parseStash(await a.kv.get(okKey));
    if (!stash)
        return null;
    const missKey = key(c, "miss", a);
    const n = await a.kv.incr(missKey, c.peekTtl);
    if (n > c.maxMisses) {
        await a.kv.del(okKey);
        return fail("expired", c.m.expired);
    }
    if (stash.h === h) {
        await a.kv.del(missKey);
        if (!a.consume)
            return PASSED;
        // 先核销后删暂存:核销时中心不可用(busy)就留着暂存,玩家拿同一个码重试即可(2.31.0;以前 getdel 先删,中心一抖码就白烧)。
        // 并发两次消费:票据 jti 在中心一次性,只有一次能过,另一次得 used → expired。
        const r = await redeem(c, a.cl, stash.t, a.ch, a.purpose, a.to);
        if (r.code !== "busy")
            await a.kv.del(okKey);
        return r;
    }
    if (n >= c.maxMisses) {
        await a.kv.del(okKey);
        return fail("expired", c.m.expired);
    }
    return "miss";
}
const OUTAGE_STASH_SEC = 300; // 核销兜底暂存秒数上限(核销时中心不可用、离线也验不了票时用)
async function checkPassed(c, a, h, resultToken) {
    if (a.consume) {
        const r = await redeem(c, a.cl, resultToken, a.ch, a.purpose, a.to);
        // 码在中心已作废,核销时中心不可用 → 把票据暂存,同一个码重试走 checkStash 再核销(不白烧码)
        if (r.code === "busy")
            await stashForRetry(c, a, h, resultToken);
        return r;
    }
    const ttl = await stashTtl(c, a.cl, resultToken, a.ch, a.purpose, a.to);
    if (ttl === null)
        return fail("busy", c.m.busy);
    if (ttl <= 0)
        return fail("expired", c.m.expired);
    await putStash(c, a, h, resultToken, ttl);
    return PASSED;
}
async function stashForRetry(c, a, h, token) {
    try {
        const ttl = await stashTtl(c, a.cl, token, a.ch, a.purpose, a.to);
        if (ttl === 0 || (ttl !== null && ttl < 0))
            return;
        await putStash(c, a, h, token, Math.min(ttl ?? OUTAGE_STASH_SEC, OUTAGE_STASH_SEC, c.peekTtl));
    }
    catch (e) {
        c.log("warn", "redeem outage stash failed", { error: String(e) });
    }
}
async function centerVerdict(c, a, vidKey, h, r) {
    if (r.status === "unavailable") {
        c.log("warn", "check unavailable, fail-closed", { channel: a.ch, purpose: a.purpose, reason: r.reason });
        return fail("busy", c.m.busy);
    }
    if (r.status === "rejected") {
        c.log("warn", "check rejected", { channel: a.ch, purpose: a.purpose, error: r.error });
        return fail("wrong", "验证码错误或已过期");
    }
    if (r.body.ok === true && typeof r.body.resultToken === "string" && r.body.resultToken) {
        await a.kv.del(vidKey);
        return checkPassed(c, a, h, r.body.resultToken);
    }
    if (r.body.attemptsLeft === 0) {
        await a.kv.del(vidKey);
        return fail("expired", c.m.expired);
    }
    if (!Number.isInteger(r.body.attemptsLeft))
        return fail("wrong", c.m.wrong);
    return { ok: false, code: "wrong", message: c.m.wrongLeft.replace("{n}", String(r.body.attemptsLeft)), attemptsLeft: r.body.attemptsLeft };
}
async function checkInner(c, a) {
    const h = codeHash(c, a, a.code);
    const s = await checkStash(c, a, h);
    if (s && s !== "miss")
        return s;
    const vidKey = key(c, "vid", a);
    const vid = await a.kv.get(vidKey);
    if (!vid)
        return s === "miss" ? fail("wrong", c.m.wrong) : fail("no-code", c.m.noCode);
    const r = await a.cl.otp.check({ verificationId: vid, code: a.code, purpose: a.purpose, subject: a.to });
    return centerVerdict(c, a, vidKey, h, r);
}
/** consume=false 只读校验(对了也不作废,见文件头);true 校验并消费(在线核销结果票据) */
async function check(c, codeRe, ch, to, purpose, code, consume, opts) {
    const trimmed = (code ?? "").trim();
    if (!codeRe.test(trimmed))
        return fail("format", c.m.format);
    const cl = c.o.client();
    const kv = await kvOrNull(c);
    if (!cl || !kv)
        return fail("busy", c.m.busy);
    try {
        return await checkInner(c, { cl, kv, ch, to, purpose, code: trimmed, consume, intent: opts?.intent });
    }
    catch (e) {
        c.log("error", "check failed (kv), fail-closed", { error: String(e) });
        return fail("busy", c.m.busy);
    }
}
export function createSiteOtp(o) {
    const c = {
        o,
        m: { ...DEFAULT_OTP_MESSAGES, ...o.messages },
        log: o.log ?? consoleLog,
        maxMisses: o.maxPeekMisses ?? 3,
        peekTtl: o.peekTtlSec ?? 600,
        now: o.now ?? Date.now,
    };
    const codeRe = o.codePattern ?? /^\d{6}$/;
    return {
        send: (i, refuse) => send(c, i, refuse),
        sendIfExists: (i, exists, opts) => sendIfExists(c, i, exists, opts),
        check: (channel, to, purpose, code, consume, opts) => check(c, codeRe, channel, to, purpose, code, consume, opts),
        proofOnly: (proof, remoteIp, purpose) => proofOnly(c, proof, remoteIp, purpose),
        captchaOnly: (token, remoteIp) => captchaOnly(c, token, remoteIp),
    };
}
