// 登录后的两个提示：老账号没绑手机号 → 每次登录都弹「绑定手机号」（「下次再说」只关这一次）；
// 免费用户第一次进来 → 弹一次会员介绍（本机按账号标记 member-intro-seen:<用户名>，同一台电脑换人登录各弹各的）。先绑手机，再看介绍。
import type { LicenseStatus } from "../api/types-account";
import { createStore } from "../shared/store";

const INTRO_KEY = "member-intro-seen";
const introKey = (username: string): string => `${INTRO_KEY}:${username}`;

export const prompts = createStore({ bindPhoneOpen: false, introOpen: false, introFor: "" });

/** 换账号：两个提示都收起（account.ts 的 resetAccountScopedState 调）。 */
export function resetPrompts(): void {
  prompts.set({ bindPhoneOpen: false, introOpen: false, introFor: "" });
}

function introSeen(username: string): boolean {
  try {
    return localStorage.getItem(introKey(username)) === "1";
  } catch {
    return true;
  }
}

/** 免费用户还没看过会员介绍就弹一次（启动时和登录后都会调）。 */
export function maybeShowMemberIntro(s: LicenseStatus): void {
  if (s.enabled && s.signedIn && !s.member && !s.deviceLimitReached && !introSeen(s.username))
    prompts.set({ introOpen: true, introFor: s.username });
}

/** 每次登录成功后调用。 */
export function promptAfterSignIn(s: LicenseStatus): void {
  if (s.enabled && s.signedIn && s.phoneBound === false) prompts.set({ bindPhoneOpen: true });
  maybeShowMemberIntro(s);
}

export function closeBindPhone(): void {
  prompts.set({ bindPhoneOpen: false });
}

export function closeMemberIntro(): void {
  try {
    localStorage.setItem(introKey(prompts.get().introFor), "1");
    localStorage.removeItem(INTRO_KEY); // 旧版不分账号的标记
  } catch {
    /* 存不了就下次再弹 */
  }
  prompts.set({ introOpen: false });
}
