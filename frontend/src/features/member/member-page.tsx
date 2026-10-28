// 侧栏「会员」（免费用户：权益对比 + 价格 + 开通）/「我的权益」（会员：套餐、到期、设备 x / y、同步状态）。
// 开通走现有的套餐卡片 → 付款框（AccountDialogs 里的 PaymentDialog）。
import { Button, InlineAlert, PageBody, PageHeader, Panel } from "@ankotti/admin-ui";
import { Crown, FolderSync, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { openSettings } from "../../app/nav";
import { useStore } from "../../shared/store";
import { isPaidMember, license, loadCommerce, openMembership } from "../../state/account";
import { PlanPicker } from "../account/plan-picker";
import { EntitlementSummary } from "./entitlement-summary";
import "../account/account.css";

/** 侧栏名字跟着档位变。 */
export function memberNavTitle(member: boolean): string {
  return member ? "我的权益" : "会员";
}

function SyncHint() {
  return (
    <InlineAlert tone="info" title="云同步怎么用">
      开通会员后登录即自动同步：在一台电脑上改了节点、规则或设置，10
      秒后上传到云端，其他电脑启动时自动拉取；两边都改过会让你选「用云端」还是「用本机」。
      云端还能另存多份配置（普通会员 1 份、超级会员 5 份）并用分享码分享给朋友。POWER云
      官方线路和账号信息不会被同步或分享。
    </InlineAlert>
  );
}

function MyBenefits() {
  return (
    <>
      <Panel
        title="我的权益"
        actions={
          <span className="ps-set-actions">
            <Button variant="outline" onClick={() => openSettings("sync")}>
              <FolderSync />
              配置与同步
            </Button>
            <Button onClick={openMembership}>
              <Crown />
              续费 / 升级
            </Button>
          </span>
        }
      >
        <EntitlementSummary showPhone={false} />
      </Panel>
      <SyncHint />
    </>
  );
}

function BecomeMember() {
  const loading = useStore(license, (s) => s.loading);
  return (
    <>
      <Panel title="当前：免费版" description="全部功能可用，同时 1 台设备；云同步是会员功能。">
        <EntitlementSummary showPhone={false} />
      </Panel>
      <SyncHint />
      <Panel
        title="开通会员"
        description="选好时长点「开通」，扫码支付后几秒内自动到账，设备名额和云同步立即生效。"
        actions={
          <Button variant="ghost" size="sm" loading={loading} loadingText="加载中…" onClick={() => void loadCommerce()}>
            <RefreshCw />
            刷新价格
          </Button>
        }
      >
        <PlanPicker />
      </Panel>
    </>
  );
}

export function MemberPage() {
  const member = useStore(license, (s) => isPaidMember(s.status));
  useEffect(() => void loadCommerce(), []);
  return (
    <>
      <PageHeader title={memberNavTitle(member)} />
      <PageBody>
        <div className="ps-member-page">{member ? <MyBenefits /> : <BecomeMember />}</div>
      </PageBody>
    </>
  );
}
