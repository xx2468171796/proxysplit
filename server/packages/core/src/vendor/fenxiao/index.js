// 对外入口:只做转出,实现放在各自的文件里(单测直接 import 那些文件,不经过入口)。
export { chainUnder, computeShares } from "./compute.js";
export { changesFor, DEFAULT_TEXTS, formatCny, noticesFor } from "./integrate.js";
export { isValidCode, normalizeCode } from "./members.js";
export { assertFxPolicy, BPS, canPromote, DEFAULT_FX_POLICY, findTier, MAX_CHAIN, MAX_LEVELS, productRule, ratesFor, SAFE_LEVELS, withdrawalFee, withPolicyDefaults, } from "./policy.js";
export { parsePolicy, policyToJson } from "./policy-json.js";
export { createFenxiao } from "./service.js";
export { DEFAULT_TABLES } from "./sql.js";
export * from "./types.js";
