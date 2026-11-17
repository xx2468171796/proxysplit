/**
 * 传输层:**只用 node:http(s),不用 fetch**。
 *
 * Node 的 fetch 会悄悄丢掉调用方手动设的 `host` 头、换成 `127.0.0.1:<port>`;验证服务按站点域名绑定凭证,
 * 于是每一张票都核验失败(GX / F7 2026-11-02 每笔支付都「安全验证已失效」)。这里显式带 Host,测试用真实端口断言。
 *
 * - 总时限:从发起到读完响应整体不超过 timeoutMs(不是单次 socket 空闲),到点 destroy。
 * - 响应体上限 64 KB(AJ 出题带两张图,单独放到 256 KB),超了直接断开,不把异常大的响应读进内存。
 * - https baseUrl:TLS SNI / 证书校验用 baseUrl 的主机名(servername),而不是 Host 头里的站点域名
 *   —— 验证服务的证书是它自己的域名;Host 头只是业务绑定。
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
export const MAX_RESPONSE_BYTES = 64 * 1024;
export function send(baseUrl, method, path, headers, body, timeoutMs, maxBytes = MAX_RESPONSE_BYTES) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, baseUrl);
        const isHttps = url.protocol === "https:";
        const request = isHttps ? httpsRequest : httpRequest;
        const opts = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers, ...(isHttps ? { servername: url.hostname } : {}) };
        const req = request(opts, (res) => {
            const chunks = [];
            let n = 0;
            res.on("data", (c) => {
                n += c.length;
                if (n > maxBytes) {
                    req.destroy(new Error("response too large"));
                    return;
                }
                chunks.push(c);
            });
            res.on("end", () => {
                clearTimeout(deadline);
                resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
            });
            res.on("error", reject);
        });
        const deadline = setTimeout(() => req.destroy(new Error("timeout")), timeoutMs);
        req.on("error", (e) => {
            clearTimeout(deadline);
            reject(e);
        });
        req.end(body);
    });
}
export function parseObject(text) {
    try {
        const v = JSON.parse(text);
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    }
    catch {
        return null;
    }
}
