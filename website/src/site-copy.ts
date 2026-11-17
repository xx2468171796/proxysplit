// 官网上会随服务端数据变化的几句话：接口错误提示、设备数说明。纯函数，不依赖浏览器（site-copy.test.ts 用 node --test 跑）。

/** 服务端错误码 → 中文提示（服务端的 message 多为内部口吻或英文时用这里的话）。 */
const ERROR_TEXT: Record<string, string> = {
  PHONE_TAKEN: "这个手机号已经注册过了，请直接下载软件登录。",
  SMS_COOLDOWN: "验证码发送太频繁，请稍等一会儿再试。",
  SMS_DAILY_LIMIT: "这个手机号今天获取验证码的次数已达上限，请明天再试。",
  SMS_UNAVAILABLE: "短信服务暂时不可用，请稍后再试。",
  SMS_SEND_FAILED: "短信发送失败，请稍后再试。",
  SMS_CODE_INVALID: "验证码不对或已过期，请重新获取。",
  IDENTITY_TAKEN: "这个用户名已经被注册了，换一个试试。",
  REGISTRATION_DISABLED: "当前暂停开放注册，请稍后再来。",
  IP_ACCOUNT_LIMIT: "当前网络注册的账号已达上限，请直接登录或联系客服。",
  DEVICE_ACCOUNT_LIMIT: "该设备注册的账号已达上限，请使用已有账号登录。",
  VALIDATION_ERROR: "填写的内容格式不对，请检查手机号、验证码、用户名和密码。",
  RATE_LIMITED: "操作太频繁了，请稍后再试。",
};

/**
 * 给用户看的错误提示。
 * 短信验证码相关（SMS_ 开头）：服务端的原话优先 —— 还要等几秒、今天还能发几次、验证码还能试几次只有服务端知道，
 * 本地的话只在服务端没给时兜底。其它错误码：本地的中文说明优先，不认识的码用服务端的话。
 */
export function errorMessage(code: string, serverMessage: string | undefined): string {
  const local = ERROR_TEXT[code];
  const text = code.startsWith("SMS_") ? serverMessage || local : local || serverMessage;
  return text || "请求失败，请稍后重试。";
}

/** 套餐目录接口里随套餐一起给的：免费版能用几台设备、现在用什么付款。 */
export type CatalogExtras = { freeDevices: number; paymentMethods: string[] };

/** 从接口响应里取这两项；老服务端不给时按「免费 1 台、微信」兜底。 */
export function catalogExtras(body: unknown): CatalogExtras {
  const b = (body ?? {}) as { freeDevices?: unknown; paymentMethods?: unknown };
  const free =
    typeof b.freeDevices === "number" && Number.isInteger(b.freeDevices) && b.freeDevices >= 0 ? b.freeDevices : 1;
  const methods = Array.isArray(b.paymentMethods)
    ? b.paymentMethods.filter((m): m is string => m === "wechat" || m === "alipay")
    : [];
  return { freeDevices: free, paymentMethods: methods.length ? methods : ["wechat"] };
}

const PAY_APP: Record<string, string> = { wechat: "微信", alipay: "支付宝" };

/** 「用手机微信扫码付款」这半句：付款方式跟着服务端当前的收款通道走。 */
export function payLine(methods: readonly string[]): string {
  const names = methods.map((m) => PAY_APP[m]).filter(Boolean);
  return `用手机${names.length ? names.join("或") : "微信"}扫码付款`;
}

/** 套餐卡上的设备数：和客户端同一种说法 —— 套餐给的是在免费版的台数之外「另加」的台数。 */
export const planDevicesLabel = (maxDevices: number): string => `另加 ${maxDevices} 台设备`;

/** 套餐卡权益里的那一行。免费版 0 台时不提免费版。 */
export const planDevicesLine = (maxDevices: number, freeDevices: number): string =>
  freeDevices > 0
    ? `在免费版的 ${freeDevices} 台之外，${planDevicesLabel(maxDevices)}`
    : `可以在 ${maxDevices} 台设备上用`;

type TierPlan = { tier: string; maxDevices: number };

function tierRange(plans: readonly TierPlan[], tier: string): string {
  const counts = plans.filter((p) => p.tier === tier).map((p) => p.maxDevices);
  if (!counts.length) return "";
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? `另加 ${min} 台` : `另加 ${min}～${max} 台`;
}

/** 会员区的一句设备数说明：台数从套餐接口算，不写死。 */
export function devicesLine(plans: readonly TierPlan[], freeDevices = 1): string {
  const parts = [
    ["普通会员", tierRange(plans, "standard")],
    ["超级会员", tierRange(plans, "premium")],
  ]
    .filter(([, range]) => range)
    .map(([name, range]) => `${name}${range}`);
  const free = freeDevices > 0 ? `免费版可以在 ${freeDevices} 台电脑上用；` : "";
  return parts.length ? `${free}开通会员后另加设备：${parts.join("，")}。` : `${free}开通会员后按套餐另加设备。`;
}
