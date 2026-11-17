/**
 * Site SDK for the unified payment service (zhifu-service, 4.0.0+): a site backend creates / queries
 * orders with `createPayClient` and fulfils on the service's signed notify with `notifyHandler`.
 * Dependency-free (node:crypto only). Amounts are integer cents; "paid" is only what the notify says.
 */
export { nodeNotifyListener, registerNotifyRoute } from "./adapters.js";
export { createPayClient, } from "./client.js";
export { isPayServiceError, PAY_ERROR_CODES, PayServiceError, PLAYER_WAIT_CODES, } from "./errors.js";
export { createMockCenter } from "./mock.js";
export { ACK_BODY, memoryDedupe, notifyHandler, } from "./notify.js";
export { createPayConfigSync, effectiveTiers, checkResponseSignature, payAmountError, payConfigSignature, } from "./pay-config.js";
export { canonical, sign, verify } from "./sign.js";
export { API_VERSION, SDK_VERSION } from "./version.js";
export { PAY_UI_VERSION, parsePayUi, refusalPayUi, isQueuedRefusal, isOutageRefusal, isOutageUi, uiOutage, PAY_OUTAGE_TITLE, PAY_OUTAGE_BODY, runPayUiAction, uiBlocked, uiCheckResult, uiOpenOrder, uiPayNotice, uiQueued, queueLine, queueEtaText, QUEUE_PATIENCE, uiReturnedUnpaid, uiQrExpired, uiCooldown, countdownBody, countdownLeftSec, mmss, PAY_CANCEL_CONFIRM, } from "./ui.js";
export { ensurePayOpen, guardPayOutage, payOutageOf, watchPayOutage, } from "../client/pay-outage.js";
