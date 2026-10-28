// 设备名额已满闸门（已登录、本机未激活）：不在 AdminShell 里的整页，居中一栏。免费用户不会被拦在这里。
// 顶部标题 + 退出账号 → 横幅 / 错误 → 设备名额已满时先解绑旧设备 → 选套餐 → 公告；付款框盖在上面。
import { Button, ConfirmDialog, InlineAlert, Panel } from "@ankotti/admin-ui";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { NetBlockedBanner } from "../../app/banners";
import logo from "../../assets/proxysplit-logo.svg";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { logoutAccount } from "../../state/account-sso";
import { DeviceTable } from "./device-table";
import { GateAnnouncements } from "./gate-announcements";
import { PaymentDialog } from "./payment-dialog";
import { PlanPicker } from "./plan-picker";
import "./account.css";

type Props = { netBlocked: string; onDismissNetBlocked: () => void };

function GateHeader() {
  const status = useStore(license, (s) => s.status);
  const [confirm, setConfirm] = useState(false);
  const full = status.deviceLimitReached;
  return (
    <header className="ps-gate-head">
      <img src={logo} alt="" className="ps-gate-logo" />
      <div className="ps-grow">
        <h1 className="ps-gate-title">{full ? "设备名额已满，请先解绑旧设备" : "选择适合你的会员套餐"}</h1>
        <p className="ps-gate-sub">
          {full
            ? "本机已安全登录，但尚未激活，代理无法启动。解绑下方任意一台旧设备后，本机会自动激活。"
            : `你好，${status.username}。当前账号暂无有效会员，完成支付后将在几秒内自动到账。`}
        </p>
      </div>
      <Button variant="outline" onClick={() => setConfirm(true)}>
        <LogOut />
        退出账号
      </Button>
      <ConfirmDialog
        open={confirm}
        title="退出当前账号？"
        description="退出后代理会停止，POWER云 订阅会一并移除。"
        tone="warning"
        confirmLabel="退出账号"
        onConfirm={async () => {
          const err = await logoutAccount();
          if (err) throw new Error(err);
        }}
        onClose={() => setConfirm(false)}
      />
    </header>
  );
}

function DeviceLimit() {
  const maxDevices = useStore(license, (s) => s.status.maxDevices);
  const count = useStore(license, (s) => s.devices.length);
  return (
    <>
      <InlineAlert tone="warning" title="本机待激活">
        已达到 {maxDevices} 台设备上限。请在下方解绑一台旧设备；解绑成功后系统会自动绑定本机并恢复启动权限。
      </InlineAlert>
      <div className="ps-gate-block">
        <Panel title="选择要解绑的旧设备" count={`${count} / ${maxDevices || "—"} 台`}>
          <DeviceTable caption="已绑定设备" emptyLabel="暂无可解绑设备" />
        </Panel>
      </div>
    </>
  );
}

export function MemberGate({ netBlocked, onDismissNetBlocked }: Props) {
  const full = useStore(license, (s) => s.status.deviceLimitReached);
  const error = useStore(license, (s) => s.error);
  return (
    <div className="ps-gate">
      <NetBlockedBanner netBlocked={netBlocked} onDismissNetBlocked={onDismissNetBlocked} />
      <div className="ps-gate-column">
        <GateHeader />
        {error ? (
          <InlineAlert tone="error" title="操作没完成" onClose={() => license.set({ error: "" })}>
            {error}
          </InlineAlert>
        ) : null}
        {full ? <DeviceLimit /> : null}
        <div className="ps-gate-block">
          <Panel
            title="不想解绑？开通会员多绑几台"
            description="会员设备数 = 免费 1 台 + 套餐设备数，按需要的电脑数量选择即可。"
          >
            <PlanPicker />
          </Panel>
        </div>
        <GateAnnouncements />
      </div>
      <PaymentDialog />
    </div>
  );
}
