// 会改动节点 / 订阅的账号流程：POWER云 浏览器授权、AI 编程官网免登录下载、退出账号。
// 它们同时动账号和用户数据两个 store，所以单独放这里，account.ts 不依赖 data.ts。
import { api } from "../api/backend";
import { license, loadCommerce, refreshLicense } from "./account";
import { refreshNodes, refreshSubs, reloadData } from "./data";
import { closePayment } from "./payment";
import { promptAfterSignIn } from "./prompts";
import { refreshStatus } from "./runtime";

const NOTICE = "NOTICE:";

/** 登录之后：会员、订阅、节点、应用规则（中转站客户首次登录会预置常用程序）。 */
async function afterPowerVPNLogin(): Promise<void> {
  await refreshLicense();
  await refreshSubs();
  await reloadData();
  await loadCommerce();
  promptAfterSignIn(license.get().status);
}

/** 浏览器授权（最多等 5 分钟）→ 登录 → 自动添加「POWER云」订阅。返回 { err } 或 { notice }。 */
export async function loginPowerVPN(): Promise<{ err?: string; notice?: string }> {
  license.set({ powervpnBusy: true });
  const res = await api.loginPowerVPN().finally(() => license.set({ powervpnBusy: false }));
  if (res && !res.startsWith(NOTICE)) return { err: res };
  await afterPowerVPNLogin();
  return { notice: res ? res.slice(NOTICE.length) : undefined };
}

/** 从 AI 编程官网下载的程序：文件名里带一次性凭据，后台自动登录。 */
export async function awaitAutoLogin(): Promise<{ err?: string; notice?: string }> {
  if (!(await api.autoLoginPending().catch(() => false))) return {};
  license.set({ powervpnBusy: true, autoLoginBusy: true });
  const res = await api
    .waitAutoLogin()
    .catch(() => "")
    .finally(() => license.set({ powervpnBusy: false, autoLoginBusy: false }));
  if (!res) return {};
  if (res !== "OK" && !res.startsWith(NOTICE)) {
    return license.get().status.signedIn ? {} : { err: `自动登录没成功（${res}），请点「用 AI 编程官网账号登录」` };
  }
  await afterPowerVPNLogin();
  return { notice: res === "OK" ? "已自动登录，节点和常用程序都加好了，点「启动」即可" : res.slice(NOTICE.length) };
}

/** 退出账号：代理会停止，POWER云 订阅随之移除。 */
export async function logoutAccount(): Promise<string> {
  const err = await api.logout();
  if (err) return `退出失败：${err}`;
  await api.logoutPowerVPN();
  await refreshSubs();
  await refreshNodes();
  closePayment();
  license.set({ membershipOpen: false });
  await refreshLicense();
  await refreshStatus();
  await loadCommerce();
  return "";
}
