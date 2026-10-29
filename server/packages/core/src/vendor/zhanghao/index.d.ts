/**
 * zhanghao 包入口。宿主一般只需要:
 *   import { createZhanghao } from "zhanghao";
 * 存储与 KV 从 ./store/* 与 ./kv/* 取(生产用 PG store + Redis 适配器,内存版只给测试)。
 */
export * from "./types.ts";
export type { Clock, KvLike, LoginGuard, PasswordHasher, SingleSession } from "./ports.ts";
export type { BetaCodeInsert, BetaCodeListFilter, BetaCodePatch, InsertAdminActionData, InsertUserData, InsertUserResult, SearchFilter, StoreTx, UniqueField, UserPatch, ZhanghaoStore, } from "./store/types.ts";
export type { AdminContext, LoginInput, LoginPolicy, PasswordPolicy, RegisterInput, UsernamePolicy, Zhanghao, ZhanghaoConfig, ZhanghaoEvent, ZhanghaoOptions, } from "./service-contract.ts";
export { createZhanghao } from "./service.ts";
export { classifyIdentifier, loginLookupOrder, normalizeNickname, pickUniqueNicknameMatch, NICKNAME_LOGIN_CANDIDATE_LIMIT, type LoginLookupKind, type LoginLookupOptions, type LoginLookupStep, displayNameOf, maskEmail, maskPhone, normalizeEmail, normalizePhone, normalizeUsername, parseSearchQuery, } from "./identifier.ts";
export { DEFAULT_PASSWORD_MAX_LENGTH, DEFAULT_PASSWORD_MIN_LENGTH, assertPassword, createScryptHasher, explainPassword, type PasswordLengthPolicy, type ScryptOptions, } from "./password.ts";
export { decodeJwtUnsafe, signJwt, verifyJwt, type JwtPayload, type SignOptions, type VerifyOptions } from "./tokens.ts";
export { keys, type ZhanghaoKeys } from "./keys.ts";
export { MemoryZhanghaoStore } from "./store/memory.ts";
export { createMemoryKv, type MemoryKv } from "./kv/memory.ts";
export { beijingDayBucket, bucketTtlSec, createPasswordResetQuota, DEFAULT_DAILY_LIMIT as DEFAULT_PASSWORD_RESET_DAILY_LIMIT, } from "./password-reset-quota.ts";
export type { PasswordResetQuota, PasswordResetQuotaKv, PasswordResetQuotaOptions, QuotaVerdict, } from "./password-reset-quota.ts";
export { OPEN_REGISTRATION_POLICY, createRegistrationControl, dayKeyIn, deriveBetaCode, nextDayStartIn, normalizeBetaCode, normalizeFingerprint, } from "./registration-control.ts";
export type { BetaCodeMode, CreateBetaCodesInput, DeviceAction, RegistrationControl, RegistrationControlOptions, RegistrationPolicy, RegistrationStatus, } from "./registration-control.ts";
export { BANNED_NICKNAME_ABBREVIATIONS, BANNED_NICKNAME_WORDS, DEFAULT_NICKNAME_MESSAGES, NICKNAME_REJECT_MESSAGE, containsPhoneNumber, defaultNicknameFor, explainNickname, maskPhonesInText, nicknameIsOffensive, nicknameScanForm, } from "./nickname.ts";
export type { NicknameMessages, NicknameRule } from "./nickname.ts";
export { defaultNicknameCandidates, nicknameKey, nicknameResetNotice, pickReplacementNickname, sweepOffensiveNicknames, } from "./nickname-sweep.ts";
export type { NicknameResetNotice, NicknameSweepOptions, NicknameSweepResult, NicknameSweepUser } from "./nickname-sweep.ts";