/**
 * tongzhi —— 统一通知模块。接入看 INTEGRATION.md(照抄即落地),AI 发通知看 AI-CONTROL.md。
 * 服务端从这里 import;浏览器 / React / CLI 各走自己的子路径(tongzhi/client · tongzhi/react · tongzhi/cli)。
 */
export * from "./types.js";
export { createTongzhi, nextLocalMidnight } from "./service.js";
export { DEFAULTS, LIMITS, normalizeInput, normalizeAudience, applyPatch, isLive, isWithinWindow, phaseOf, matchesAudience, shouldPopup, isDismissed, isUnread, compareNotices, isSafeUrl, dayKey, pgArrayLiteral, noticeToWire, noticeToPlayerWire, noticeFromWire, receiptToWire, newBatchId, } from "./core/logic.js";
export { parseMarkdown, parseInline, plainText } from "./core/markdown.js";
export { BUILTIN_TEMPLATES, applyTemplate, mergeTemplates } from "./core/templates.js";
export { MemoryTongzhiStore } from "./store/memory.js";
export { createSqlPgTongzhiStore, mapNoticeRow } from "./store/sql-pg.js";
export { createTongzhiHttpHandlers, queryFromSearchParams, feedItemToWire, bundleToWire, HTTP_STATUS_BY_CODE, } from "./http/handlers.js";
export { createTongzhiAiControl, headersToRecord, isLoopbackIp } from "./ai-control.js";
export { createTongzhiRealtime } from "./realtime/index.js";
export { createPushReceiver, createPushSender } from "./push/index.js";
export { buildSignedHeaders, verifySignature, generateSecret, HEADER as PUSH_HEADER } from "./push/signature.js";
export { tongzhiEdgeConf, probeTongzhiEdge } from "./edge/index.js";
