// 会员中心弹框（已有权益或试用时用）：账号概要、兑换码、错误、选套餐、重新加载。
// 已授权时关掉它会一并关掉付款框（停止查单）；无权益用户用的是整页闸门，不经过这里。
import { Button, DescriptionList, Dialog, InlineAlert } from "@ankotti/admin-ui";
import { RefreshCw } from "lucide-react";
import { fmtDateTime } from "../../shared/format";
import { useStore } from "../../shared/store";
import { closeMembership, license, loadCommerce } from "../../state/account";
import { closePayment } from "../../state/payment";
import { PlanPicker } from "./plan-picker";
import { RedeemInline } from "./redeem-dialog";

function titleOf(planCode: string, authenticated: boolean): string {
  if (planCode === "trial") return "试用期间也可提前开通会员";
  return authenticated ? "续费或升级会员" : "选择适合你的会员方案";
}

function AccountSummary() {
  const status = useStore(license, (s) => s.status);
  const deviceCount = useStore(license, (s) => s.devices.length);
  return (
    <DescriptionList
      columns={2}
      items={[
        { label: "当前账号", value: status.username || "未登录" },
        { label: "当前套餐", value: status.plan || "免费试用 / 未开通" },
        { label: "授权到期", value: status.expiresAt ? fmtDateTime(status.expiresAt) : "以支付后授权为准" },
        { label: "已绑设备", value: `${deviceCount} / ${status.maxDevices || "—"} 台` },
      ]}
    />
  );
}

export function MembershipDialog() {
  const open = useStore(license, (s) => s.membershipOpen);
  const planCode = useStore(license, (s) => s.status.planCode);
  const authenticated = useStore(license, (s) => s.status.authenticated);
  const loading = useStore(license, (s) => s.loading);
  const error = useStore(license, (s) => s.error);
  if (!open) return null;

  const close = () => {
    closeMembership();
    if (authenticated) closePayment();
  };
  return (
    <Dialog
      open
      size="xl"
      title={titleOf(planCode, authenticated)}
      description="按使用时长和设备数量选择即可，支付成功后会员权益会自动生效。"
      onClose={close}
      headerActions={
        <Button variant="ghost" size="sm" loading={loading} loadingText="加载中…" onClick={() => void loadCommerce()}>
          <RefreshCw />
          重新加载
        </Button>
      }
    >
      <div className="ps-plans">
        <AccountSummary />
        <RedeemInline />
        {error ? (
          <InlineAlert tone="error" title="操作没完成" onClose={() => license.set({ error: "" })}>
            {error}
          </InlineAlert>
        ) : null}
        <PlanPicker />
      </div>
    </Dialog>
  );
}
