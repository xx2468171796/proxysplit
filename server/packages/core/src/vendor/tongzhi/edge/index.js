const ipLine = (ips) => ips.map((ip) => `    allow ${ip};`).join("\n");
export function tongzhiEdgeConf(o) {
    const adminPath = o.adminPath ?? "/api/admin/tongzhi/";
    const proxy = [
        `    proxy_set_header Host $host;`,
        `    proxy_set_header X-Real-IP $remote_addr;`,
        `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
        `    proxy_set_header X-Forwarded-Proto $scheme;`,
        ...(o.proxyExtra ?? []),
        `    proxy_pass ${o.upstream};`,
    ].join("\n");
    const adminGuard = Array.isArray(o.trusted)
        ? `${ipLine(o.trusted)}\n    deny all;`
        : `    if (${o.trusted.variable} = 0) { return 403; }`;
    let out = `# tongzhi edge —— 管理路由只放运维来源(应用层仍有会话/令牌闸,这是第二道)
location ^~ ${adminPath} {
${adminGuard}
${proxy}
}
`;
    if (o.pushFrom?.length) {
        const pushPath = o.pushPath ?? "/api/integrations/tongzhi/push";
        out += `
# tongzhi edge —— 跨站推送口只放会员中心出口(签名 + nonce 仍在应用层验)
location = ${pushPath} {
${ipLine(o.pushFrom)}
    deny all;
    limit_except POST { deny all; }
${proxy}
}
`;
    }
    return out;
}
/**
 * 公网探测:GET <publicBase><adminPath>status
 *   403 / 404(被边缘拦)      → ok(从公网)
 *   401(过了边缘,应用层拦)  → 公网视角 = 边缘没生效(仍安全,但第二道没接);可信来源视角 = ok
 *   200                      → 🔴 管理口对外裸奔
 *   5xx / 0                  → 探不到,别当绿灯
 */
export async function probeTongzhiEdge(o) {
    const f = o.fetch ?? globalThis.fetch;
    const url = `${o.publicBase.replace(/\/$/, "")}${(o.adminPath ?? "/api/admin/tongzhi/").replace(/\/?$/, "/")}status`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 8000);
    let status = 0;
    try {
        status = (await f(url, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 tongzhi-edge-probe" } })).status;
    }
    catch {
        status = 0;
    }
    finally {
        clearTimeout(timer);
    }
    if (status === 200)
        return { ok: false, status, verdict: "管理口返回 200:对外裸奔,应用层鉴权也没拦住,立刻查", url };
    if (status === 0 || status >= 500)
        return { ok: false, status, verdict: "探不到 / 5xx,不能当绿灯", url };
    if (status === 401)
        return o.fromTrusted ? { ok: true, status, verdict: "过了边缘、被应用层拦(可信来源期望值)", url } : { ok: false, status, verdict: "应用层拦住了但边缘没拦(第二道未生效)", url };
    if (status === 403 || status === 404)
        return { ok: true, status, verdict: "边缘拦住", url };
    return { ok: false, status, verdict: `意外状态 ${status}`, url };
}
