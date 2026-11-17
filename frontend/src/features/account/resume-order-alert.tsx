// 「你有一单还没付完」提示 +「继续支付」。订单从服务端订单列表认（state/payment-resume），所以关掉付款框、重启软件后都还在。
// 会员页 / 会员中心 / 设备闸门的套餐区都显示；顶部横幅（banner）只在已经付过一部分钱时出现。
import { Button, InlineAlert } from "@ankotti/admin-ui";
import { useMemo } from "react";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { payment, resumePayment } from "../../state/payment";
import { findResumable, resumeLine } from "../../state/payment-resume";

export function ResumeOrderAlert({ banner = false }: { banner?: boolean }) {
  const orders = useStore(license, (s) => s.orders);
  const paying = useStore(payment, (s) => s.order !== null);
  const busy = useStore(payment, (s) => s.buying);
  // 订单列表每分钟重读一次（每次都是新数组），到期的订单随之消失
  const open = useMemo(() => findResumable(orders, Date.now()), [orders]);
  if (!open || paying || (banner && open.paid === 0)) return null;
  return (
    <InlineAlert
      banner={banner}
      tone={open.paid > 0 ? "warning" : "info"}
      title={open.paid > 0 ? "会员订单还没付完" : "有一单还没付款"}
      action={
        <Button size="sm" loading={busy} loadingText="请稍候…" onClick={() => void resumePayment()}>
          继续支付
        </Button>
      }
    >
      {resumeLine(open)}
    </InlineAlert>
  );
}
