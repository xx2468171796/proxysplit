// 主界面里常驻的账号弹框：会员中心、兑换码、推广赚钱、付款（付款框在最后，盖在会员中心上面）。
import { FenxiaoDialog } from "./fenxiao-dialog";
import { MembershipDialog } from "./membership-dialog";
import { PaymentDialog } from "./payment-dialog";
import { RedeemDialog } from "./redeem-dialog";
import "./account.css";

export function AccountDialogs() {
  return (
    <>
      <MembershipDialog />
      <RedeemDialog />
      <FenxiaoDialog />
      <PaymentDialog />
    </>
  );
}
