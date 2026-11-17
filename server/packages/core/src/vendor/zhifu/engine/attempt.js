import { createUnderHandoff } from "../handoff/index.js";
/**
 * Opening an upstream attempt (both pay modes): pick a channel, reserve the attempt row BEFORE calling upstream
 * (a crash between "upstream created" and "stored" can never leave an unknown paid order), create only through
 * the hand-off standard, record the breaker outcome, store the result; on failure fail over to other channels
 * (first pick + at most 2 extra). A channel the player chose (`preferred`) is never swapped behind their back.
 */
export const MAX_ATTEMPT_TRIES = 3;
export class AttemptError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "AttemptError";
        this.code = code;
    }
}
const NO_CHANNEL = "暂无可用的收款通道，请稍后再试";
const NO_PAY_URL = "上游未返回支付链接";
async function callUpstream(port, pick, row) {
    const result = await createUnderHandoff(pick.adapter, await port.handoffSource(pick, row));
    const ok = result.ok && Boolean(result.payUrl);
    await port.recordCreate(pick, ok, ok ? null : (result.error ?? NO_PAY_URL));
    return { row: await port.storeResult(row, pick, result), error: result.error ?? NO_PAY_URL };
}
/** `first` = an attempt the caller already reserved in its own transaction. */
export async function openAttemptWith(port, first) {
    const exclude = [];
    let lastError = null;
    let next = first;
    for (let i = 0; i < MAX_ATTEMPT_TRIES; i++) {
        let pick;
        let row;
        if (next)
            ({ pick, row } = next);
        else {
            try {
                pick = await port.route(exclude);
            }
            catch (error) {
                throw lastError ?? error;
            }
            row = await port.reserve(pick);
        }
        next = undefined;
        if (row) {
            const out = await callUpstream(port, pick, row);
            if (out.row)
                return out.row;
            lastError = new AttemptError("CHANNEL_FAILED", out.error || "通道下单失败，请换一条线路或稍后再试");
        }
        else
            lastError = new AttemptError("NO_CHANNEL", NO_CHANNEL);
        if (pick.preferred)
            break;
        exclude.push(pick.code);
    }
    throw lastError ?? new AttemptError("NO_CHANNEL", NO_CHANNEL);
}
