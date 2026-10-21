// 设置页第一节「账户与设备」（SideNavLayout 里的一节，用 SectionCard 块）：
// 授权概要 + 续费 / 刷新授权 / 退出 → 修改密码 → 设备管理。
import { Button, ConfirmDialog, DescriptionList, InlineAlert, SectionCard, StatusBadge } from "@ankotti/admin-ui";
import { Crown, KeyRound, LogOut, Monitor, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { fmtDateTime } from "../../shared/format";
import { useStore } from "../../shared/store";
import { license, loadCommerce, openMembership, refreshEntitlement } from "../../state/account";
import { logoutAccount } from "../../state/account-sso";
import { DeviceTable } from "./device-table";
import { PasswordForm } from "./password-form";
import "./account.css";

function LogoutConfirm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="退出当前账号？"
      description="退出后代理会停止，POWER云 订阅会一并移除。"
      tone="warning"
      confirmLabel="退出账号"
      onConfirm={async () => {
        const err = await logoutAccount();
        if (err) throw new Error(err);
      }}
      onClose={onClose}
    />
  );
}

function LicenseCard({ onLogout }: { onLogout: () => void }) {
  const { say } = useFeedback();
  const status = useStore(license, (s) => s.status);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    const err = await refreshEntitlement();
    setRefreshing(false);
    say(err || "授权已刷新");
  };
  return (
    <SectionCard
      title="账户与授权"
      icon={<ShieldCheck />}
      actions={<StatusBadge tone="success">已授权</StatusBadge>}
      footer={
        <div className="ps-account-actions">
          <Button onClick={openMembership}>
            <Crown />
            续费 / 升级套餐
          </Button>
          <Button variant="outline" loading={refreshing} loadingText="刷新中…" onClick={() => void refresh()}>
            <RefreshCw />
            刷新授权
          </Button>
          <Button variant="destructive-outline" onClick={onLogout}>
            <LogOut />
            退出账号
          </Button>
        </div>
      }
    >
      <DescriptionList
        columns={2}
        items={[
          { label: "用户名", value: status.username },
          { label: "套餐", value: status.plan || "默认套餐" },
          { label: "授权到期", value: status.expiresAt ? fmtDateTime(status.expiresAt) : "以服务端为准" },
          { label: "离线可用至", value: status.offlineUntil ? fmtDateTime(status.offlineUntil) : "需在线校验" },
        ]}
      />
    </SectionCard>
  );
}

function DevicesCard({ onLogout }: { onLogout: () => void }) {
  const count = useStore(license, (s) => s.devices.length);
  const max = useStore(license, (s) => s.status.maxDevices);
  const loading = useStore(license, (s) => s.loading);
  const loadError = useStore(license, (s) => s.deviceLoadError);
  return (
    <SectionCard
      title={`设备管理 · ${count} / ${max || "—"} 台`}
      icon={<Monitor />}
      actions={
        <Button variant="ghost" size="sm" loading={loading} loadingText="刷新中…" onClick={() => void loadCommerce()}>
          <RefreshCw />
          刷新设备
        </Button>
      }
      flush={!loadError}
    >
      {loadError ? (
        <InlineAlert
          tone="error"
          title="设备读取失败"
          action={
            <Button size="sm" variant="destructive-outline" onClick={onLogout}>
              退出并重新登录
            </Button>
          }
        >
          {loadError}
        </InlineAlert>
      ) : (
        <DeviceTable caption="已绑定设备" emptyLabel="暂无已绑定设备，点「刷新设备」重新读取服务端状态" />
      )}
    </SectionCard>
  );
}

export function AccountSection() {
  const enabled = useStore(license, (s) => s.status.enabled);
  const [confirmLogout, setConfirmLogout] = useState(false);
  if (!enabled) return null;
  const askLogout = () => setConfirmLogout(true);
  return (
    <>
      <LicenseCard onLogout={askLogout} />
      <SectionCard title="修改密码" icon={<KeyRound />}>
        <PasswordForm />
      </SectionCard>
      <DevicesCard onLogout={askLogout} />
      <LogoutConfirm open={confirmLogout} onClose={() => setConfirmLogout(false)} />
    </>
  );
}
