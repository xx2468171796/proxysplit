// 付款前人机验证（用途 pay）：验证层与中继页协议在 ./human-verify（发短信验证码也用它）。
// 凭证绑定站点域名 + 用途，只交给后端，由支付中心 SDK 兑换。
import { type HumanVerifyResult, openHumanVerify, withHumanVerify } from "./human-verify";

export const CHALLENGE_REQUIRED = "PAY_CHALLENGE_REQUIRED";

type Created = { errCode?: string };

export const openPayVerify = (): Promise<HumanVerifyResult> => openHumanVerify("pay");

/**
 * 先验证再下单。取消验证 = 不下单（null）。验证页没起来就不带凭证下单，由支付中心决定（关了「每笔都验」照常能付）。
 * 中心仍回 PAY_CHALLENGE_REQUIRED（凭证过期 / 被判无效）就再弹一次、重下一次，最多一次，避免死循环。
 */
export function placeVerifiedOrder<R extends Created>(
  create: (hvToken: string) => Promise<R>,
  verify: () => Promise<HumanVerifyResult> = openPayVerify,
): Promise<R | null> {
  return withHumanVerify(CHALLENGE_REQUIRED, create, verify);
}
