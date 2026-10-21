// 支付宝付款框：二维码、订单名 · 金额、拆单说明、截止时间；「本机打开支付宝」「我已支付，刷新状态」。
// 到账由 state/payment 每 3 秒自动查单，关掉框即停止查单（订单到期自动失效）。
import { Button, Dialog, DialogFooter, InlineAlert, Note, Spinner, StatusBadge } from "@ankotti/admin-ui";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { MemberOrder } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { fmtDateTime, fmtYuan } from "../../shared/format";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { closePayment, confirmPaid, openPaymentInBrowser, payment } from "../../state/payment";
import "./account.css";

function SplitNote({ order, total }: { order: MemberOrder; total: number }) {
  const amount = `¥${fmtYuan(order.amountCents)}`;
  return (
    <InlineAlert tone="warning" title={`本单需分 ${total} 笔支付`} density="compact">
      因支付渠道单笔限额，需分 {total} 笔分别支付。请先扫码付本笔 {amount}，付完会自动跳出下一笔二维码，{total}{" "}
      笔全部付完才会开通会员，中途请勿关闭。
    </InlineAlert>
  );
}

function OrderInfo({ order }: { order: MemberOrder }) {
  const split = useStore(payment, (s) => s.split);
  const splitIdx = useStore(payment, (s) => s.splitIdx);
  const isSplit = split.length > 1;
  return (
    <div className="ps-pay-info">
      {isSplit ? (
        <StatusBadge tone="warning">
          分 {split.length} 笔支付 · 第 {splitIdx + 1} 笔
        </StatusBadge>
      ) : (
        <StatusBadge tone="info">支付宝安全支付</StatusBadge>
      )}
      <h3 className="ps-pay-title">
        {order.planName} · ¥{fmtYuan(order.amountCents)}
      </h3>
      {isSplit ? (
        <SplitNote order={order} total={split.length} />
      ) : (
        <Note as="p">打开手机支付宝扫描二维码完成付款，支付成功后会自动到账，也可以点「我已支付，刷新状态」。</Note>
      )}
      <Note as="p">请在 {fmtDateTime(order.expiresAt)} 前完成支付</Note>
    </div>
  );
}

export function PaymentDialog() {
  const { say } = useFeedback();
  const order = useStore(payment, (s) => s.order);
  const qr = useStore(payment, (s) => s.qr);
  const busy = useStore(payment, (s) => s.busy);
  const error = useStore(license, (s) => s.error);
  if (!order) return null;
  return (
    <Dialog
      open
      size="md"
      title="扫码支付"
      onClose={closePayment}
      footer={
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void openPaymentInBrowser().catch((e: unknown) => say(`打开支付宝失败：${String(e)}`))}
          >
            <ExternalLink />
            本机打开支付宝
          </Button>
          <Button loading={busy} loadingText="正在查询…" onClick={() => void confirmPaid()}>
            <RefreshCw />
            我已支付，刷新状态
          </Button>
        </DialogFooter>
      }
    >
      {error ? (
        <InlineAlert tone="error" title="付款没完成" density="compact">
          {error}
        </InlineAlert>
      ) : null}
      <div className="ps-pay">
        <div className="ps-pay-qr">
          <div className="ps-qr-tile">
            {qr ? (
              <img src={qr} alt="支付宝付款二维码" width={180} height={180} />
            ) : (
              <Spinner size={32} label="正在生成二维码" />
            )}
          </div>
          <Note>支付宝扫码</Note>
        </div>
        <OrderInfo order={order} />
      </div>
    </Dialog>
  );
}
