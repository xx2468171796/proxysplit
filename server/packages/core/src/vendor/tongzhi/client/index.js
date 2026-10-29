export class TongzhiHttpError extends Error {
    status;
    code;
    constructor(status, code, message) { super(message); this.name = "TongzhiHttpError"; this.status = status; this.code = code; }
}
export function createTongzhiClient(o = {}) {
    const base = (o.base ?? "/api/tongzhi").replace(/\/$/, "");
    const f = o.fetch ?? ((...a) => globalThis.fetch(...a));
    async function call(method, path, body, query) {
        const qs = query ? Object.entries(query).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
        const extra = typeof o.headers === "function" ? o.headers() : o.headers ?? {};
        const res = await f(`${base}${path}${qs ? `?${qs}` : ""}`, {
            method, credentials: "include",
            headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            data = null;
        }
        if (!res.ok) {
            const e = (data ?? {});
            throw new TongzhiHttpError(res.status, e.code ?? "HTTP_ERROR", e.message ?? `HTTP ${res.status}`);
        }
        return data;
    }
    return {
        base,
        bundle: (inboxLimit) => call("GET", "/bundle", undefined, { inboxLimit }),
        feed: (q = {}) => call("GET", "/feed", undefined, { ...q, surfaces: q.surfaces?.join(",") }),
        unread: () => call("GET", "/unread"),
        seen: (ids) => call("POST", "/seen", { ids }),
        read: (ids) => call("POST", "/read", { ids }),
        readAll: () => call("POST", "/read-all", {}),
        archive: (ids) => call("POST", "/archive", { ids }),
        dismiss: (id, hours) => call("POST", "/dismiss", { id, hours }),
        popupShown: (id) => call("POST", "/popup-shown", { id }),
    };
}
/** 实际轮询间隔:有推送时取 pushPollMs(不小于 pollMs),pollMs 为 0 = 不轮询 */
export function feedPollMs(o) {
    const base = o.pollMs ?? 60000;
    if (base <= 0 || !o.push)
        return base;
    return Math.max(base, o.pushPollMs ?? 300_000);
}
/** 推送源的启停(只在主标签页开,与 SSE 同一条规矩);订阅抛错 = 当没有推送,靠轮询兜底 */
function pushHandle(push, onInvalidate, active) {
    let stopPush = null;
    return {
        ensure() {
            if (!push || stopPush || !active())
                return;
            try {
                stopPush = push(onInvalidate);
            }
            catch {
                stopPush = null;
            }
        },
        stop() {
            const s = stopPush;
            stopPush = null;
            try {
                s?.();
            }
            catch { /* 停不掉也不影响页面 */ }
        },
    };
}
/** 与框架无关的状态容器:subscribe 拿快照,start/stop 管生命周期 */
export function createFeedState(o) {
    let state = { bundle: null, loading: false, error: null, lastFetchedAt: null };
    const listeners = new Set();
    let timer = null;
    let es = null;
    let started = false;
    let inflight = null;
    const push = pushHandle(o.push, () => void refresh(), () => started && isLeader);
    const set = (patch) => { state = { ...state, ...patch }; for (const l of listeners)
        l(state); };
    async function refresh() {
        if (inflight)
            return inflight;
        inflight = (async () => {
            set({ loading: true });
            try {
                const b = await o.client.bundle();
                set({ bundle: b, error: null, lastFetchedAt: Date.now() });
                if (isLeader && bc) {
                    try {
                        bc.postMessage({ t: "bundle", bundle: b });
                    }
                    catch { /* noop */ }
                }
            }
            catch (err) {
                set({ error: String(err?.message ?? err) });
            }
            finally {
                set({ loading: false });
                inflight = null;
            }
        })();
        return inflight;
    }
    const onFocus = () => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden")
            return;
        ensureSse();
        if (state.lastFetchedAt && Date.now() - state.lastFetchedAt < (o.minFocusGapMs ?? 5000))
            return;
        void refresh();
    };
    /* ---- 多标签页:navigator.locks 选主,只有主页开 SSE;主页每次拉到 bundle 通过 BroadcastChannel 分给其它页(它们不再各自轮询) ---- */
    const bcName = `tongzhi:${o.client.base}`;
    let bc = null;
    let isLeader = false;
    let leaderRelease = null;
    let leaderTimer = null;
    function tryLead() {
        if (isLeader || typeof navigator === "undefined" || !("locks" in navigator)) {
            if (!isLeader && typeof navigator !== "undefined" && !("locks" in navigator))
                isLeader = true;
            return;
        }
        void navigator.locks
            .request(`${bcName}:leader`, { ifAvailable: true }, (lock) => {
            if (!lock)
                return Promise.resolve();
            isLeader = true;
            ensureSse();
            if (timer === null)
                startPolling();
            void refresh();
            return new Promise((resolve) => { leaderRelease = resolve; });
        }).catch(() => { isLeader = true; });
    }
    /* ---- SSE:EventSource 遇 401/429/5xx 是永久关闭,不会自己重连 —— 聚焦 / 回前台 / 定时 时若已关就按退避重建 ---- */
    let sseBackoffMs = 3000;
    let sseRetryTimer = null;
    function ensureSse() {
        push.ensure();
        if (o.push || !o.sseUrl || typeof EventSource === "undefined" || !started || !isLeader)
            return;
        if (es && es.readyState !== 2 /* CLOSED */)
            return;
        try {
            es = new EventSource(o.sseUrl, { withCredentials: true });
            es.addEventListener("invalidate", () => void refresh());
            es.addEventListener("bye", () => { es?.close(); es = null; });
            es.onopen = () => { sseBackoffMs = 3000; };
            es.onerror = () => {
                if (es?.readyState !== 2)
                    return; // 浏览器自己会重连的情况不管
                if (sseRetryTimer)
                    clearTimeout(sseRetryTimer);
                sseRetryTimer = setTimeout(() => { sseRetryTimer = null; ensureSse(); }, sseBackoffMs);
                sseBackoffMs = Math.min(sseBackoffMs * 2, 60_000);
            };
        }
        catch {
            es = null;
        }
    }
    function startPolling() {
        const poll = feedPollMs(o);
        if (poll > 0 && timer === null)
            timer = setInterval(() => { if (!isLeader && bc)
                return; if (typeof document === "undefined" || document.visibilityState !== "hidden")
                void refresh(); }, poll);
    }
    function start() {
        if (started)
            return;
        started = true;
        if (typeof BroadcastChannel !== "undefined") {
            try {
                bc = new BroadcastChannel(bcName);
                bc.onmessage = (ev) => {
                    const m = ev.data;
                    if (m?.t === "bundle" && m.bundle && !isLeader)
                        set({ bundle: m.bundle, error: null, lastFetchedAt: Date.now() });
                    if (m?.t === "invalidate" && !isLeader)
                        void refresh();
                };
            }
            catch {
                bc = null;
            }
        }
        if (!bc)
            isLeader = true;
        tryLead();
        if (typeof navigator !== "undefined" && "locks" in navigator && bc)
            leaderTimer = setInterval(tryLead, 15_000);
        void refresh();
        startPolling();
        if (o.refreshOnFocus !== false && typeof window !== "undefined") {
            window.addEventListener("focus", onFocus);
            document.addEventListener("visibilitychange", onFocus);
        }
        ensureSse();
    }
    function stop() {
        if (!started)
            return;
        started = false;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (leaderTimer) {
            clearInterval(leaderTimer);
            leaderTimer = null;
        }
        if (sseRetryTimer) {
            clearTimeout(sseRetryTimer);
            sseRetryTimer = null;
        }
        if (typeof window !== "undefined") {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onFocus);
        }
        if (es) {
            es.close();
            es = null;
        }
        push.stop();
        if (leaderRelease) {
            leaderRelease();
            leaderRelease = null;
        }
        isLeader = false;
        if (bc) {
            bc.close();
            bc = null;
        }
    }
    /** 本地乐观更新(标已读后不用等下一轮拉取) */
    function patchLocal(fn) { if (state.bundle) {
        set({ bundle: fn(state.bundle) });
        if (bc) {
            try {
                bc.postMessage({ t: "bundle", bundle: state.bundle });
            }
            catch { /* noop */ }
        }
    } }
    function subscribe(l) { listeners.add(l); l(state); return () => { listeners.delete(l); }; }
    return { start, stop, refresh, subscribe, patchLocal, getState: () => state };
}
/** 管理侧 REST 客户端(后台 React 组件 / 浏览器里的管理页用;鉴权走宿主 cookie) */
export function createTongzhiAdminClient(o = {}) {
    const base = (o.base ?? "/api/admin/tongzhi").replace(/\/$/, "");
    const f = o.fetch ?? ((...a) => globalThis.fetch(...a));
    async function call(method, path, body, query) {
        const qs = query ? Object.entries(query).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
        const extra = typeof o.headers === "function" ? o.headers() : o.headers ?? {};
        const res = await f(`${base}${path}${qs ? `?${qs}` : ""}`, { method, credentials: "include", headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined });
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            data = null;
        }
        if (!res.ok) {
            const e = (data ?? {});
            throw new TongzhiHttpError(res.status, e.code ?? "HTTP_ERROR", e.message ?? `HTTP ${res.status}`);
        }
        return data;
    }
    return {
        list: (q = {}) => call("GET", "/notices", undefined, q),
        get: (id) => call("GET", `/notices/${encodeURIComponent(id)}`),
        create: (input, publish = false) => call("POST", "/notices", { ...input, publish }),
        update: (id, patch) => call("PUT", `/notices/${encodeURIComponent(id)}`, patch),
        remove: (id) => call("DELETE", `/notices/${encodeURIComponent(id)}`),
        publish: (id) => call("POST", `/notices/${encodeURIComponent(id)}/publish`, {}),
        revoke: (id) => call("POST", `/notices/${encodeURIComponent(id)}/revoke`, {}),
        revokeBatch: (batchId) => call("POST", `/batches/${encodeURIComponent(batchId)}/revoke`, {}),
        stats: (id) => call("GET", `/notices/${encodeURIComponent(id)}/stats`),
        preview: (input) => call("POST", "/preview", input),
        send: (input) => call("POST", "/send", input),
        templates: () => call("GET", "/templates"),
        renderTemplate: (key, vars) => call("POST", `/templates/${encodeURIComponent(key)}/render`, { vars }),
        status: () => call("GET", "/status"),
    };
}
