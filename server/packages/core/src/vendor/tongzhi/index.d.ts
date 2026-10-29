/**
 * tongzhi —— 统一通知模块。接入看 INTEGRATION.md(照抄即落地),AI 发通知看 AI-CONTROL.md。
 * 服务端从这里 import;浏览器 / React / CLI 各走自己的子路径(tongzhi/client · tongzhi/react · tongzhi/cli)。
 */
export * from "./types.ts";
export { createTongzhi, nextLocalMidnight, type Tongzhi, type TongzhiOptions, type TongzhiEvent, type Actor, type Bundle, type PreviewResult, type TongzhiRealtimeLike } from "./service.ts";
export { DEFAULTS, LIMITS, normalizeInput, normalizeAudience, applyPatch, isLive, isWithinWindow, phaseOf, matchesAudience, shouldPopup, isDismissed, isUnread, compareNotices, isSafeUrl, dayKey, pgArrayLiteral, noticeToWire, noticeToPlayerWire, noticeFromWire, receiptToWire, newBatchId, type NoticeWire, type NoticePlayerWire, type ReceiptWire, } from "./core/logic.ts";
export { parseMarkdown, parseInline, plainText, type Block, type Inline } from "./core/markdown.ts";
export { BUILTIN_TEMPLATES, applyTemplate, mergeTemplates, type NoticeTemplate } from "./core/templates.ts";
export type { TongzhiStore, ReceiptPatch } from "./store/types.ts";
export { MemoryTongzhiStore } from "./store/memory.ts";
export { createSqlPgTongzhiStore, mapNoticeRow, type SqlQueryable, type SqlPgTongzhiStoreOptions } from "./store/sql-pg.ts";
export { createTongzhiHttpHandlers, queryFromSearchParams, feedItemToWire, bundleToWire, HTTP_STATUS_BY_CODE, type TongzhiHttpHandlers, type HttpRequestLike, type HandlerResult, type FeedItemWire, type BundleWire, } from "./http/handlers.ts";
export { createTongzhiAiControl, headersToRecord, isLoopbackIp, type TongzhiAiControl, type AiControlIdentity } from "./ai-control.ts";
export { createTongzhiRealtime, type TongzhiRealtime, type SseClient } from "./realtime/index.ts";
export { createPushReceiver, createPushSender, type PushOp, type PushSite, type PushResult, type NonceStore, type PushSender } from "./push/index.ts";
export { buildSignedHeaders, verifySignature, generateSecret, HEADER as PUSH_HEADER } from "./push/signature.ts";
export { tongzhiEdgeConf, probeTongzhiEdge } from "./edge/index.ts";