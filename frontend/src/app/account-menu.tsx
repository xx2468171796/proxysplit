// 侧栏左下账号菜单：会员中心、兑换码、推广赚钱、设置；联系方式与官网（中转站渠道不显示）；退出账号（先确认）。
import { ConfirmDialog } from "@ankotti/admin-ui";
import { Crown, GitFork, Globe, HandCoins, MessageCircle, Settings, Ticket, Users } from "lucide-react";
import { useState } from "react";
import { api } from "../api/backend";
import { remainingLabel } from "../shared/format";
import { useStore } from "../shared/store";
import { isAigwChannel, license, openMembership, openRedeem } from "../state/account";
import { logoutAccount } from "../state/account-sso";
import { openFenxiao } from "../state/fenxiao";
import { copyText } from "../state/system";
import { navigate } from "./nav";
import { useFeedback } from "./use-feedback";

export const QQ_GROUP = "719243244";
export const SERVICE_WECHAT = "zyg69996";

export function useAccountMenu() {
  const { say } = useFeedback();
  const status = useStore(license, (s) => s.status);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const copy = async (value: string, label: string) => {
    say((await copyText(value)) ? `已复制${label} ${value}` : `${label}：${value}`, "info");
  };
  const open = (fn: () => Promise<void>, what: string) => () =>
    void fn().catch((e: unknown) => say(`打开${what}失败：${String(e)}`));

  const contact = isAigwChannel(status)
    ? []
    : [
        {
          id: "qq",
          label: `QQ 群 ${QQ_GROUP}`,
          icon: Users,
          hint: "点击复制",
          onSelect: () => void copy(QQ_GROUP, "QQ 群号"),
        },
        {
          id: "wechat",
          label: `客服微信 ${SERVICE_WECHAT}`,
          icon: MessageCircle,
          hint: "点击复制",
          onSelect: () => void copy(SERVICE_WECHAT, "客服微信"),
        },
        {
          id: "site",
          label: "官网",
          icon: Globe,
          hint: "proxysplit.zygskins.cn",
          onSelect: open(api.openWebsite, "官网"),
        },
        { id: "github", label: "GitHub", icon: GitFork, onSelect: open(api.openGitHub, "GitHub") },
      ];
  const member = status.enabled
    ? [
        { id: "member", label: "会员中心", icon: Crown, onSelect: openMembership },
        { id: "redeem", label: "兑换码开通会员", icon: Ticket, onSelect: openRedeem },
        ...(status.signedIn ? [{ id: "fenxiao", label: "推广赚钱", icon: HandCoins, onSelect: openFenxiao }] : []),
      ]
    : [];
  const identity = status.plan || (status.signedIn ? "未开通会员" : "未登录");

  return {
    account: status.enabled
      ? {
          name: status.username || "未登录",
          role: `${identity} · ${remainingLabel(status.expiresAt, status.planCode)}`,
        }
      : { name: "ProxySplit", role: "本地模式" },
    accountMenu: [
      ...member,
      { id: "settings", label: "设置", icon: Settings, onSelect: () => navigate("settings") },
      ...contact,
    ],
    onSignOut: status.enabled && status.signedIn ? () => setConfirmLogout(true) : undefined,
    dialogs: (
      <ConfirmDialog
        open={confirmLogout}
        title="退出当前账号？"
        description="退出后代理会停止，POWER云 订阅会一并移除。"
        tone="warning"
        confirmLabel="退出账号"
        onConfirm={async () => {
          const err = await logoutAccount();
          if (err) throw new Error(err);
        }}
        onClose={() => setConfirmLogout(false)}
      />
    ),
  };
}
