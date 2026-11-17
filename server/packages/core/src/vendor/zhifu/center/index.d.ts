/**
 * Site SDK for the unified payment service (zhifu-service, 4.0.0+): a site backend creates / queries
 * orders with `createPayClient` and fulfils on the service's signed notify with `notifyHandler`.
 * Dependency-free (node:crypto only). Amounts are integer cents; "paid" is only what the notify says.
 */
export { nodeNotifyListener, registerNotifyRoute } from "./adapters.ts";
export { type CreateOrderInput, createPayClient, type OrderRef, type OrderView, type PayClient, type PayClientOptions, type PayInfo, type PayLine, type Player, type PayRulesView, type PayStatusView, type QueuePollView, type RefundView, } from "./client.ts";
export { isPayServiceError, PAY_ERROR_CODES, type PayErrorCode, type PayResult, PayServiceError, PLAYER_WAIT_CODES, } from "./errors.ts";
export { createMockCenter } from "./mock.ts";
export { ACK_BODY, type DedupeStore, memoryDedupe, type NotifyHandlerOptions, notifyHandler, type NotifyEvent, type PaidNotification, } from "./notify.ts";
export { createPayConfigSync, effectiveTiers, type LocalPayConfig, type PayConfig, type PayConfigSync, type PayConfigSyncOptions, type PayTier, checkResponseSignature, payAmountError, payConfigSignature, } from "./pay-config.ts";
export { canonical, type Flat, sign, verify } from "./sign.ts";
export { API_VERSION, SDK_VERSION } from "./version.ts";
export { PAY_UI_VERSION, parsePayUi, refusalPayUi, isQueuedRefusal, isOutageRefusal, isOutageUi, uiOutage, PAY_OUTAGE_TITLE, PAY_OUTAGE_BODY, runPayUiAction, uiBlocked, uiCheckResult, uiOpenOrder, uiPayNotice, uiQueued, queueLine, queueEtaText, QUEUE_PATIENCE, uiReturnedUnpaid, uiQrExpired, uiCooldown, countdownBody, countdownLeftSec, mmss, PAY_CANCEL_CONFIRM, type PayUiCountdown, type PayUi, type PayUiAction, type PayUiButton, type PayUiHandlers, type PayUiKind, type PayUiTone, type PayUiQueue, } from "./ui.ts";
export { type EnsurePayOpenOptions, ensurePayOpen, guardPayOutage, type PayOutageRenderer, payOutageOf, watchPayOutage, } from "../client/pay-outage.ts";