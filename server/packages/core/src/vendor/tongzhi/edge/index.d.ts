/**
 * 边缘加固(OpenResty / leichiwaf 前置的站):
 *   1. tongzhiEdgeConf()  生成一段 nginx location:管理路由 /api/admin/tongzhi/ 只放运维来源,其余 403;
 *      跨站推送口 /api/integrations/tongzhi/push 只放会员中心出口 IP(可选)
 *   2. probeTongzhiEdge() 部署后**从公网真打一枪**验证上面那段真的生效 —— 「配了」和「生效了」是两回事
 *
 * 方向与 zhifu 相反(zhifu 是给回调整段关引擎豁免),与 quanyi 相同(更严)。别照抄 zhifu。
 * 应用层本来就有鉴权(后台会话 / AI 令牌 + loopback),边缘这层是第二道;边缘没接也不裸奔。
 */
export interface EdgeConfOptions {
    /** 管理路由前缀,默认 /api/admin/tongzhi/ */
    adminPath?: string;
    /** 放行的运维来源:nginx 变量(如 $trusted_src)或 IP/CIDR 列表 */
    trusted: string[] | {
        variable: string;
    };
    /** 跨站推送口(默认 /api/integrations/tongzhi/push);给了 pushFrom 才生成 */
    pushPath?: string;
    pushFrom?: string[];
    /** 转发给应用的 upstream 名 / 地址(生成 proxy_pass 用) */
    upstream: string;
    /** 附加 proxy 设置行(真实 IP 头等),默认带 X-Real-IP / X-Forwarded-For / Host */
    proxyExtra?: string[];
}
export declare function tongzhiEdgeConf(o: EdgeConfOptions): string;
export interface ProbeOptions {
    /** 站点公网地址,如 https://5ff.zygskins.cn */
    publicBase: string;
    adminPath?: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
    /** 从可信来源探测时传 true:期望 401(过了边缘、被应用层拦) */
    fromTrusted?: boolean;
}
export interface ProbeResult {
    ok: boolean;
    status: number;
    verdict: string;
    url: string;
}
/**
 * 公网探测:GET <publicBase><adminPath>status
 *   403 / 404(被边缘拦)      → ok(从公网)
 *   401(过了边缘,应用层拦)  → 公网视角 = 边缘没生效(仍安全,但第二道没接);可信来源视角 = ok
 *   200                      → 🔴 管理口对外裸奔
 *   5xx / 0                  → 探不到,别当绿灯
 */
export declare function probeTongzhiEdge(o: ProbeOptions): Promise<ProbeResult>;