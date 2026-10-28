// 登录后的两个提示：老账号没绑手机号 → 每次登录都弹「绑定手机号」（「下次再说」只关这一次）；
// 免费用户第一次进来 → 弹一次会员介绍（本机标记 member-intro-seen）。先绑手机，再看介绍。
import type { LicenseStatus } from "../api/types-account";
import { createStore } from "../shared/store";

const INTRO_KEY = "member-intro-seen";

export const prompts = createStore({ bindPhoneOpen: false, introOpen: false });

function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return true;
  }
}

/** 免费用户还没看过会员介绍就弹一次（启动时和登录后都会调）。 */
export function maybeShowMemberIntro(s: LicenseStatus): void {
  if (s.enabled && s.signedIn && !s.member && !s.deviceLimitReached && !introSeen()) prompts.set({ introOpen: true });
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
    localStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* 存不了就下次再弹 */
  }
  prompts.set({ introOpen: false });
}
