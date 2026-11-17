// 会员插槽（锚点 #pricing）：套餐（服务端实时读取）+ 网页注册（表单在 register-form.tsx）。
// admin-ui-audit-ignore-file raw-control: 官网是 qiantai 前台页，不加载 admin-ui 样式，控件用 qiantai 的 q-btn / q-input / q-chip 类
import { Section } from "qiantai";
import { devicesLine, payLine } from "../site-copy";
import { type PlansState, usePlans } from "../use-site-data";
import { PlanCard } from "./plan-card";
import { RegisterForm } from "./register-form";

function Plans({ state }: { state: PlansState }) {
  if (state.status === "loading") return <p className="ps-note">正在读取套餐…</p>;
  if (state.status === "error") return <p className="ps-note">套餐暂时读不到，可以下载软件后在「会员中心」查看。</p>;
  if (!state.plans.length) return <p className="ps-note">套餐即将上架，现在下载可以先免费试用。</p>;
  return (
    <div className="ps-plans">
      {state.plans.map((p) => (
        <PlanCard key={p.code || p.name} plan={p} freeDevices={state.freeDevices} />
      ))}
    </div>
  );
}

export function PricingSlot() {
  const state = usePlans();
  const ready = state.status === "ready";
  const devices = devicesLine(ready ? state.plans : [], ready ? state.freeDevices : 1);
  return (
    <Section title="会员" desc={`新用户先免费用 3 天，同一台电脑只能领一次。${devices}`}>
      <Plans state={state} />
      <RegisterForm />
      <p className="q-muted ps-fineprint">
        在软件里选好套餐后，{payLine(ready ? state.paymentMethods : [])}
        ，付款成功后由服务器校验并自动开通，支付密钥不会存放在软件里；设备可以在软件的「账号与设备」里解绑。
      </p>
    </Section>
  );
}
