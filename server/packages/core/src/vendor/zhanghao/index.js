/**
 * zhanghao 包入口。宿主一般只需要:
 *   import { createZhanghao } from "zhanghao";
 * 存储与 KV 从 ./store/* 与 ./kv/* 取(生产用 PG store + Redis 适配器,内存版只给测试)。
 */
export * from "./types.js";
export { createZhanghao } from "./service.js";
export { classifyIdentifier, loginLookupOrder, normalizeNickname, pickUniqueNicknameMatch, NICKNAME_LOGIN_CANDIDATE_LIMIT, displayNameOf, maskEmail, maskPhone, normalizeEmail, normalizePhone, normalizeUsername, parseSearchQuery, } from "./identifier.js";
export { DEFAULT_PASSWORD_MAX_LENGTH, DEFAULT_PASSWORD_MIN_LENGTH, assertPassword, createScryptHasher, explainPassword, } from "./password.js";
export { decodeJwtUnsafe, signJwt, verifyJwt } from "./tokens.js";
export { keys } from "./keys.js";
export { MemoryZhanghaoStore } from "./store/memory.js";
export { createMemoryKv } from "./kv/memory.js";
export { beijingDayBucket, bucketTtlSec, createPasswordResetQuota, DEFAULT_DAILY_LIMIT as DEFAULT_PASSWORD_RESET_DAILY_LIMIT, } from "./password-reset-quota.js";
export { OPEN_REGISTRATION_POLICY, createRegistrationControl, dayKeyIn, deriveBetaCode, nextDayStartIn, normalizeBetaCode, normalizeFingerprint, } from "./registration-control.js";
export { BANNED_NICKNAME_ABBREVIATIONS, BANNED_NICKNAME_WORDS, DEFAULT_NICKNAME_MESSAGES, NICKNAME_REJECT_MESSAGE, containsPhoneNumber, defaultNicknameFor, explainNickname, maskPhonesInText, nicknameIsOffensive, nicknameScanForm, } from "./nickname.js";
export { defaultNicknameCandidates, nicknameKey, nicknameResetNotice, pickReplacementNickname, sweepOffensiveNicknames, } from "./nickname-sweep.js";
