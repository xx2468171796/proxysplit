// 付款框（微信 / 支付宝，按付款链接判断）：二维码、订单名 · 金额、拆单说明、截止时间；「本机打开支付宝」「我已支付，刷新状态」。
// 统一支付中心的微信码（weixin://）只能用手机扫，不出「本机打开」按钮。
// 到账由 state/payment 每 3 秒自动查单，关掉框即停止查单；没付完的订单之后可在会员页点「继续支付」接着付。
// 二维码没生成出来时显示原因和「重新生成二维码」。
import { Button, Dialog, DialogFooter, InlineAlert, Note, Spinner, StatusBadge } from "@ankotti/admin-ui";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { MemberOrder } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { fmtDateTime, fmtYuan } from "../../shared/format";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import {
  canOpenPayment,
  closePayment,
  confirmPaid,
  openPaymentInBrowser,
  payApp,
  payment,
  retryQR,
  splitProgress,
} from "../../state/payment";
import "./account.css";

function SplitNote({ order, total }: { order: MemberOrder; total: number }) {
  const amount = `¥${fmtYuan(order.amountCents)}`;
  return (
    <InlineAlert tone="warning" title={`本单需分 ${total} 笔支付`} density="compact">
      因支付渠道单笔限额，需分 {total} 笔分别支付。请先扫码付本笔 {amount}，付完会自动跳出下一笔二维码，{total}{" "}
      笔全部付完才会开通会员。中途关掉了也不要紧，回到会员页点「继续支付」就能接着付。
    </InlineAlert>
  );
}

function OrderInfo({ order }: { order: MemberOrder }) {
  const split = useStore(payment, (s) => s.split);
  const splitIdx = useStore(payment, (s) => s.splitIdx);
  const progress = splitProgress({ order, split, splitIdx });
  return (
    <div className="ps-pay-info">
      {progress ? (
        <StatusBadge tone="warning">
          分 {progress.total} 笔支付 · 第 {progress.index} 笔
        </StatusBadge>
      ) : (
        <StatusBadge tone="info">{payApp(order)}安全支付</StatusBadge>
      )}
      <h3 className="ps-pay-title">
        {order.planName} · ¥{fmtYuan(order.amountCents)}
      </h3>
      {progress ? (
        <SplitNote order={order} total={progress.total} />
      ) : (
        <Note as="p">
          打开手机{payApp(order)}扫描二维码完成付款，支付成功后会自动到账，也可以点「我已支付，刷新状态」。
        </Note>
      )}
      <Note as="p">请在 {fmtDateTime(order.expiresAt)} 前完成支付</Note>
    </div>
  );
}

function QrTile({ order }: { order: MemberOrder }) {
  const qr = useStore(payment, (s) => s.qr);
  const qrError = useStore(payment, (s) => s.qrError);
  if (qrError)
    return (
      <div className="ps-pay-qr">
        <InlineAlert tone="error" title="二维码没生成出来" density="compact">
          {qrError}。点下面的按钮再试一次；还是不行就关掉这个框重新下单。
        </InlineAlert>
        <Button variant="outline" size="sm" onClick={() => void retryQR()}>
          <RefreshCw />
          重新生成二维码
        </Button>
      </div>
    );
  return (
    <div className="ps-pay-qr">
      <div className="ps-qr-tile">
        {qr ? (
          <img src={qr} alt={`${payApp(order)}付款二维码`} width={180} height={180} />
        ) : (
          <Spinner size={32} label="正在生成二维码" />
        )}
      </div>
      <Note>{payApp(order)}扫码</Note>
    </div>
  );
}

export function PaymentDialog() {
  const { say } = useFeedback();
  const order = useStore(payment, (s) => s.order);
  const busy = useStore(payment, (s) => s.confirming);
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
          {canOpenPayment(order) ? (
            <Button
              variant="outline"
              onClick={() => void openPaymentInBrowser().catch((e: unknown) => say(`打开支付宝失败：${String(e)}`))}
            >
              <ExternalLink />
              本机打开支付宝
            </Button>
          ) : null}
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
        <QrTile order={order} />
        <OrderInfo order={order} />
      </div>
    </Dialog>
  );
}
