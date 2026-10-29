// 权益摘要（「我的权益」页和设置「账号与设备」共用）：账号、档位、到期、设备 x / y（免费 + 套餐）、手机号、云同步。
import { Button, DescriptionList } from "@ankotti/admin-ui";
import type { ReactNode } from "react";
import { fmtDateTime } from "../../shared/format";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { configSync } from "../../state/configsync";
import { prompts } from "../../state/prompts";
import { deviceSplit, devicesText, tierLabel } from "./entitlement";

function syncText(member: boolean, enabled: boolean | undefined, last: string | undefined): string {
  if (!member) return "会员专属（免费版可本地导出 / 导入）";
  if (enabled === false) return "已关闭（可在「配置与同步」打开）";
  return last ? `已开启 · 上次同步 ${fmtDateTime(last)}` : "已开启 · 还没同步过";
}

export function EntitlementSummary({ showPhone = true }: { showPhone?: boolean }) {
  const status = useStore(license, (s) => s.status);
  const used = useStore(license, (s) => s.devices.length);
  const sync = useStore(configSync, (s) => s.status);
  const split = deviceSplit(status);
  const member = !!status.member;
  const items: { label: string; value: ReactNode }[] = [
    { label: "账号", value: status.username || "未登录" },
    {
      label: "当前档位",
      value:
        member && status.plan && !status.plan.includes(tierLabel(status))
          ? `${tierLabel(status)} · ${status.plan}`
          : status.plan || tierLabel(status),
    },
    {
      label: "会员到期",
      value: member ? (status.expiresAt ? fmtDateTime(status.expiresAt) : "以服务端为准") : "免费版长期有效",
    },
    { label: "设备", value: `已用 ${used} / ${split.total} 台（${devicesText(split.free, split.plan)}）` },
    { label: "云同步", value: syncText(member, sync?.enabled, sync?.lastSyncedAt) },
  ];
  if (showPhone)
    items.push({
      label: "手机号",
      value:
        status.phoneBound === false ? (
          <Button size="xs" variant="outline" onClick={() => prompts.set({ bindPhoneOpen: true })}>
            绑定手机号
          </Button>
        ) : (
          "已绑定"
        ),
    });
  return <DescriptionList columns={2} items={items} />;
}
