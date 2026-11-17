/**
 * `yanzheng/verify-client` —— 站点接雷池验证服务 leichiwaf-verify 的**唯一**实现。
 *
 * 验证码出题判卷、短信 / 邮件验证码的生成发送核对、限额、通道凭据,全部在雷池;站点只调这里的四个方法:
 *
 * ```ts
 * import { createSecurityClient, decide } from "yanzheng/verify-client";
 * const lcv = createSecurityClient({ siteId: "gx", secret: process.env.LCV_SITE_SECRET!, host: "gx.zygskins.cn" });
 * const r = await lcv.captcha.verify({ token, action: "pay", remoteIp });
 * if ((await lcv.decide("pay", r, (b) => b.success)) !== "allow") throw …;
 * ```
 *
 * 合同见 leichiwaf `docs/verify-INTEGRATION.md`;本包 INTEGRATION.md §3.20。
 * 传输只走 node:http 并显式带 Host(Node fetch 会丢 Host,见 transport.ts)。
 */
import { DEFAULT_FAIL_CLOSED, decide, failMode, isScene } from "./fail-mode.js";
import { createIprep } from "./iprep.js";
import { createGateReporter, createProbeCache, gateRequiredIn } from "./gate-policy.js";
import { createJwksVerifier } from "./jwks.js";
import { signedHeaders, subjectHash } from "./sign.js";
import { createSitePolicy } from "./site-policy.js";
import { parseObject, send } from "./transport.js";
export { canonicalRequest, signRequest, subjectHash } from "./sign.js";
export { DEFAULT_FAIL_CLOSED, decide, failMode };
export { IPREP_DEFAULT_TIMEOUT_MS, parseIprepResult } from "./iprep.js";
export const DEFAULT_VERIFY_URL = "http://127.0.0.1:8977";
// biome-ignore lint/suspicious/noConsole: 默认日志去 console(与 site-otp 一致),站点可传 log 换掉
const consoleLog = (level, msg, meta) => console[level](`[verify-client] ${msg}`, meta ?? "");
/** AJ 出题响应带两张 PNG(base64 约 70 KB),单独放宽上限 */
const AJ_GET_MAX_BYTES = 256 * 1024;
/** 鉴权 / Host 错是本站接入配置问题,不是玩家的错 → 按 unavailable(走故障方向) */
const CONFIG_ERRORS = new Set(["UNKNOWN_SITE", "BAD_TIMESTAMP", "BAD_NONCE", "BAD_SIGNATURE", "REPLAY", "HOST_NOT_SITE"]);
function matches(p, siteId, e) {
    if (p.typ !== e.typ)
        return false;
    if (e.typ === "captcha")
        return p.action === e.action;
    return p.purpose === e.purpose && p.channel === e.subject.channel && p.sub === subjectHash(siteId, e.subject.channel, e.subject.value);
}
const PAY_TOKEN_MAX = 1024;
const PAY_TOKEN_RE = /^[A-Za-z0-9._~+/=:-]+$/;
/** HTTP 响应 → 三种结局 */
function classify(status, text) {
    const json = parseObject(text);
    if (status >= 500 || !json)
        return { status: "unavailable", reason: `http ${status}` };
    if (status >= 200 && status < 300)
        return { status: "ok", body: json };
    const error = typeof json.error === "string" ? json.error : `http ${status}`;
    if (CONFIG_ERRORS.has(error))
        return { status: "unavailable", reason: error };
    return { status: "rejected", httpStatus: status, error, body: json };
}
function redeemOutcome(r, payload) {
    if (r.status === "unavailable")
        return { ok: false, reason: "unavailable" };
    if (r.status === "ok" && r.body.ok === true)
        return { ok: true, payload };
    return { ok: false, reason: r.status === "ok" && r.body.error === "ALREADY_USED" ? "used" : "invalid" };
}
function refused(reason, detail) {
    return { pass: false, challengePassed: false, verified: false, reason, ...(detail === undefined ? {} : { detail }) };
}
/** 验证服务不可用时的支付结局:按本站 pay 故障方向 */
/** 动作 → 故障方向用的场景:标准场景按自己(login 走 login 的方向,2.40.0 修:原来一律按 pay),其余按 pay */
const sceneOf = (action) => (isScene(action) ? action : "pay");
function payOutage(detail, failClosed, scene = "pay") {
    return failMode(scene, failClosed) === "open"
        ? { pass: true, challengePassed: true, verified: false, reason: "unavailable-open", detail }
        : { pass: false, challengePassed: false, verified: false, reason: "unavailable-closed", detail };
}
/** 核销调用结局 → 支付结局 */
function payVerdict(r, failClosed, scene = "pay") {
    if (r.status === "ok")
        return r.body.success === true ? { pass: true, challengePassed: true, verified: true, reason: "verified" } : refused("bad-token", (r.body.errorCodes ?? []).join(","));
    if (r.status === "rejected")
        return refused("bad-token", r.error);
    // 非 JSON 的 4xx(前置代理拒收)是请求本身的问题,按无效票
    return /^http 4\d\d$/.test(r.reason) ? refused("bad-token", r.reason) : payOutage(r.reason, failClosed, scene);
}
function wellFormedPayToken(token) {
    return token.length <= PAY_TOKEN_MAX && PAY_TOKEN_RE.test(token);
}
export function createSecurityClient(o) {
    if (!o.siteId || !o.host)
        throw new Error("[verify-client] siteId / host 必填");
    if (typeof o.secret !== "string" || o.secret.length < 32)
        throw new Error("[verify-client] secret 至少 32 字符");
    const base = (o.baseUrl ?? DEFAULT_VERIFY_URL).replace(/\/$/, "");
    const timeoutMs = o.timeoutMs ?? 2000;
    const now = o.now ?? Date.now;
    async function call(method, path, input, maxBytes, reqTimeoutMs = timeoutMs) {
        const body = input === undefined ? "" : JSON.stringify(input);
        try {
            const res = await send(base, method, path, signedHeaders(o, method, path, body, now()), method === "POST" ? body : undefined, reqTimeoutMs, maxBytes);
            return classify(res.status, res.text);
        }
        catch (e) {
            return { status: "unavailable", reason: e instanceof Error ? e.message : String(e) };
        }
    }
    const post = (path, input) => call("POST", path, input);
    const iprep = createIprep((path, input, ms) => call("POST", path, input, undefined, ms));
    // 本站故障方向 + 闸门开关:雷池站点配置下发,5 分钟刷新,并发合并成一次拉取(见 site-policy.ts)
    const policy = createSitePolicy(() => call("GET", "/v1/s/policy"), now, o.log ?? consoleLog);
    // 服务可用性探测缓存(审计 S1):见 gate-policy.ts createProbeCache
    const probeCached = createProbeCache(policy.pull, now);
    const gateReporter = createGateReporter((items) => post("/v1/s/gate/report", { items }));
    async function refreshPolicy() {
        await policy.pull();
        return policy.failClosed();
    }
    async function payGate(input) {
        const token = input.token?.trim() ?? "";
        if (!token) {
            // 没带 token:由本 SDK 自己去探服务(签名 GET /v1/s/policy),客户端说什么都不算。
            // 探测结果短缓存(审计 S1):否则每个无票请求都打一次中心,攻击者刷无票登录就能把中心拖超时、逼出全站放行。
            const probe = await probeCached();
            return probe.ok ? refused("token-required") : payOutage(probe.reason, policy.failClosed(), sceneOf(input.action));
        }
        // 玩家给的东西先在本地挡掉畸形 / 超大值:不能让它把核销请求弄成网络错 / 代理 413 从而「被不可用」
        if (!wellFormedPayToken(token))
            return refused("bad-token", "malformed");
        const deviceFp = input.deviceFp && input.deviceFp.length <= 256 ? input.deviceFp : undefined;
        const r = await post("/v1/s/captcha/verify", { token, action: input.action ?? "pay", remoteIp: input.remoteIp, deviceFp });
        if (r.status !== "unavailable" && policy.stale())
            await policy.pull();
        return payVerdict(r, policy.failClosed(), sceneOf(input.action));
    }
    const jwks = createJwksVerifier(async () => {
        const res = await send(base, "GET", "/.well-known/jwks.json", { host: o.host }, undefined, timeoutMs);
        if (res.status !== 200)
            throw new Error(`jwks http ${res.status}`);
        return parseObject(res.text);
    }, now);
    async function verifyTicket(token, expect) {
        let p;
        try {
            p = await jwks.verifyToken(token, o.siteId);
        }
        catch {
            return { ok: false, reason: "unavailable" };
        }
        if (!p)
            return { ok: false, reason: "invalid" };
        if (!matches(p, o.siteId, expect))
            return { ok: false, reason: "mismatch" };
        if (expect.online === false)
            return { ok: true, payload: p };
        return redeemOutcome(await post("/v1/s/ticket/redeem", { token }), p);
    }
    return {
        captcha: {
            verify: (input) => post("/v1/s/captcha/verify", input),
        },
        otp: {
            send: (input) => post("/v1/s/otp/send", input),
            check: (input) => post("/v1/s/otp/check", input),
        },
        ticket: { verify: verifyTicket },
        /** IP 信誉(2.35.0):check 下单前问、outcome 单终态后回报;不可用返回 null / false,绝不抛 */
        iprep,
        /**
         * AJ-Captcha 兼容适配(2.28.0):GX / F7 这类原版客户端的站点做薄代理,协议号与线格式不变。
         * - get:出题(clientIp 必填),body 原样回给客户端
         * - check:交卷,body.repCode 原样回给客户端(0000 过 / 6110 过期 / 6111 不对)
         * - bind:交卷前把题标成支付用;action 只能由服务端写死
         * - verify:核销 captchaVerification(一次性,绑站点 + 用途)。发码不用先 verify,直接把它交给 otp.send
         */
        aj: {
            get: (input) => call("POST", "/v1/s/aj/get", input, AJ_GET_MAX_BYTES),
            check: (input) => post("/v1/s/aj/check", input),
            bind: (input) => post("/v1/s/aj/bind", input),
            verify: (input) => post("/v1/s/aj/verify", input),
        },
        /**
         * 调用结果 → 业务动作,带上本站的 failClosed。服务可用时顺带刷新过期的策略;
         * 服务不可用时不去拉(拉也拉不到),直接用手里那份。
         */
        async decide(scene, r, passed) {
            if (r.status !== "unavailable" && policy.stale())
                await refreshPolicy();
            return decide(scene, r, passed, policy.failClosed());
        },
        /**
         * 支付前人机验证的统一判定(2.27.1,业主 11-01「验证服务挂了支付照常放行」):
         * - 带 token:到服务端核销;通过 → verified;被拒 → bad-token;服务不可用 → 按本站 pay 故障方向
         * - 不带 token:SDK 自己签名探一次服务;服务正常 → token-required(必须先过验证);不可用 → 按故障方向
         * 不可用 + 放行(unavailable-open)时 `challengePassed: true`(zhifu-service 每单都验的开关否则会拒单),
         * 但 `verified: false` —— 站点不要据此开「几分钟免验」通行证,并记 warn 日志。
         * 「不可用」只来自本 SDK 自己的调用失败(网络 / 超时 / 5xx / 签名配置错),玩家无法从请求里伪造。
         */
        payGate,
        /** 启动时可主动拉一次 */
        refreshPolicy,
        /**
         * 这个动作要不要过人机验证(雷池中心按站按场景配,站点不留本地开关)。
         * 策略过期先拉一次;拉不到用手里那份 / 默认值(必验)。
         */
        async gateRequired(action) {
            if (policy.stale())
                await policy.pull();
            return gateRequiredIn(policy.gates(), action);
        },
        /** 闸门结局上报(createHumanGate 自动调;30 秒一批,失败丢弃) */
        reportGate: (action, outcome) => gateReporter.record(action, outcome),
        /** 进程退出前可手动冲一次 */
        flushGateReports: () => gateReporter.flush(),
        /** 场景的故障方向(当前本站策略),便于站点打日志 / 告警 */
        failMode: (scene) => failMode(scene, policy.failClosed()),
    };
}
export { createSiteOtp, DEFAULT_OTP_MESSAGES, withMinDuration } from "./site-otp.js";
export { createHumanGate, HUMAN_GATE_TEXT } from "./human-gate.js";
export { DEFAULT_GATES, parseGates } from "./gate-policy.js";
