export function createTongzhiRealtime(o = {}) {
    const channel = o.channel ?? "tongzhi";
    const clients = new Set();
    const perUser = o.maxConnectionsPerUser ?? 10;
    const maxTotal = o.maxConnections ?? 5000;
    let heartbeat = null;
    let subscribed = false;
    function fanout(env) {
        const frame = `event: invalidate\ndata: ${JSON.stringify({ users: env.u ? env.u.length : null })}\n\n`;
        for (const c of [...clients]) {
            if (env.u && !env.u.includes(c.userId))
                continue;
            // write 返回 false 只是背压(Node res.write 语义),不是断开;真断开会抛
            try {
                c.write(frame);
            }
            catch {
                remove(c);
            }
        }
    }
    function ensureSubscribed() {
        if (subscribed || !o.subscriber)
            return;
        subscribed = true;
        o.subscriber.on("message", (ch, payload) => {
            if (ch !== channel)
                return;
            try {
                fanout(JSON.parse(payload));
            }
            catch { /* 坏帧丢弃 */ }
        });
        // 订阅失败(Redis 还没连上 / 抖动)不能永远聋:放回 false,下次 add() 再试;也不能变成 unhandledRejection 崩进程
        Promise.resolve().then(() => o.subscriber.subscribe(channel)).catch(() => { subscribed = false; });
    }
    function ensureHeartbeat() {
        if (heartbeat || (o.heartbeatMs ?? 15000) <= 0)
            return;
        heartbeat = setInterval(() => { for (const c of [...clients]) {
            try {
                c.write(": ping\n\n");
            }
            catch {
                remove(c);
            }
        } }, o.heartbeatMs ?? 15000);
        heartbeat.unref?.();
    }
    async function invalidate(userIds) {
        const env = { t: "invalidate", u: userIds };
        if (o.publisher)
            await o.publisher.publish(channel, JSON.stringify(env));
        else if (o.local)
            fanout(env);
    }
    function add(c) {
        if (clients.size >= maxTotal)
            throw new Error("tongzhi realtime: too many connections");
        const mine = [...clients].filter((x) => x.userId === c.userId);
        // mine 为空(仅 perUser<=0 时可能)时旧写法 write 抛错被吞、remove(undefined) 是 no-op,这里直接跳过,效果一致
        const oldest = mine[0];
        if (mine.length >= perUser && oldest) {
            try {
                oldest.write("event: bye\ndata: {}\n\n");
            }
            catch { /* noop */ }
            remove(oldest);
        }
        clients.add(c);
        ensureSubscribed();
        ensureHeartbeat();
        try {
            c.write(`event: hello\ndata: {}\n\n`);
        }
        catch {
            remove(c);
        }
    }
    function remove(c) {
        if (!clients.delete(c))
            return;
        try {
            c.end();
        }
        catch { /* noop */ }
    }
    function close() { for (const c of [...clients])
        remove(c); if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
    } }
    /** Web 标准 Response(Next.js App Router / Bun / Deno 直接 return) */
    function sseResponse(userId, signal) {
        // 满额直接 503:EventSource 对非 200 不自动重连,不会形成重连风暴
        if (clients.size >= maxTotal)
            return new Response("too many connections", { status: 503, headers: { "retry-after": "30" } });
        const enc = new TextEncoder();
        let client = null;
        const stream = new ReadableStream({
            start(controller) {
                client = {
                    userId,
                    write(chunk) { try {
                        controller.enqueue(enc.encode(chunk));
                        return true;
                    }
                    catch {
                        return false;
                    } },
                    end() { try {
                        controller.close();
                    }
                    catch { /* already closed */ } },
                };
                try {
                    controller.enqueue(enc.encode("retry: 3000\n\n"));
                    add(client);
                }
                catch {
                    controller.close();
                    return;
                }
                signal?.addEventListener("abort", () => { if (client)
                    remove(client); }, { once: true });
            },
            cancel() { if (client)
                remove(client); },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
    }
    return { invalidate, add, remove, close, sseResponse, size: () => clients.size, channel };
}
