const HOUR = 3600000;
const DAY = 24 * HOUR;
/** One round (also the unit tests' entry): sweep all due orders, then prune when `prune` is set. */
export async function runStandaloneMaintenance(store, opts = {}) {
    const now = (opts.now ?? (() => new Date()))();
    const batch = opts.batch ?? 500;
    let expired = 0;
    for (let n = batch; n === batch; expired += n)
        n = await store.expireDue(now, batch);
    let pruned = 0;
    if (opts.prune) {
        const before = new Date(now.getTime() - (opts.retentionDays ?? 35) * DAY);
        for (let n = batch; n > 0 && pruned < batch * 100; pruned += n)
            n = await store.pruneLogs(before, batch);
    }
    return { expired, pruned };
}
export function startStandaloneJobs(store, opts = {}) {
    const every = opts.sweepEveryMs ?? 30000;
    const onError = opts.onError ?? ((job, e) => console.error(`[zhifu/server] ${job} failed`, e));
    let lastPrune = 0;
    let busy = false;
    const tick = async () => {
        if (busy)
            return;
        busy = true;
        const prune = Date.now() - lastPrune >= HOUR;
        try {
            await runStandaloneMaintenance(store, { ...opts, prune });
            if (prune)
                lastPrune = Date.now();
        }
        catch (e) {
            onError(prune ? "retention" : "sweep", e);
        }
        finally {
            busy = false;
        }
    };
    const timer = setInterval(() => void tick(), every);
    timer.unref?.();
    void tick();
    return { stop: () => clearInterval(timer) };
}
