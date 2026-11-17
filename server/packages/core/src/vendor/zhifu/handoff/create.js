import { buildHandoffInput, handoffViolations } from "./policy.js";
/**
 * The single upstream-create path (orders + channel tests): builds the hand-off input under the standard and
 * refuses to call the adapter when it still violates it (fail closed — nothing leaks, the breaker counts it).
 * A throwing adapter becomes `ok: false` like any other failure.
 */
export async function createUnderHandoff(adapter, source) {
    const input = buildHandoffInput(source);
    const violations = handoffViolations(input, source.centerBase, source.siteTerms);
    if (violations.length) {
        console.error(JSON.stringify({ level: "error", msg: "handoff contract violated", channel: source.channelCode, violations }));
        return { ok: false, error: `交接合同不通过：${violations.join("；")}` };
    }
    try {
        return await adapter.create(input);
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
