import { alipayChannel, alipayCredentials } from "./alipay.js";
import { huiyitongChannel, huiyitongCredentials } from "./huiyitong.js";
import { mockChannel } from "./mock.js";
import { zhongzhuanChannel, zhongzhuanCredentials } from "./zhongzhuan.js";
export * from "../wire.js";
export * from "./alipay.js";
export * from "./alipay-sign.js";
export * from "./huiyitong.js";
export * from "./mock.js";
export * from "./zhongzhuan.js";
/** Built-in factories; `mock` only when a MockUpstream is given (tests, standalone demo). */
export function builtinChannelFactories(mock) {
    return {
        zhongzhuan: ({ credentials, gatewayChannelId }) => zhongzhuanChannel({ credentials: zhongzhuanCredentials.parse(credentials), pinLine: gatewayChannelId ?? null }),
        // Third / fourth-party aggregators; `credentials.provider` picks the protocol (only 汇易通 so far).
        aggregator: ({ credentials }) => huiyitongChannel({ credentials: huiyitongCredentials.parse(credentials) }),
        alipay: ({ credentials }) => alipayChannel({ credentials: alipayCredentials.parse(credentials) }),
        ...(mock ? { mock: () => mockChannel(mock) } : {}),
    };
}
