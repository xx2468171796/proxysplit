// 免费用户第一次进来弹一次的会员介绍（关掉后本机不再弹）；绑定手机号的弹框开着时先等它。
import { Button, Dialog } from "@ankotti/admin-ui";
import { navigate } from "../../app/nav";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";
import { closeMemberIntro, prompts } from "../../state/prompts";
import { BenefitTable } from "./benefit-table";

export function MemberIntroDialog() {
  const open = useStore(prompts, (s) => s.introOpen && !s.bindPhoneOpen);
  const plans = useStore(license, (s) => s.plans);
  if (!open) return null;
  const goMember = () => {
    closeMemberIntro();
    navigate("member");
  };
  return (
    <Dialog
      open
      size="lg"
      title="欢迎使用 ProxySplit 免费版"
      description="免费版全部功能都能用，只是同时只能在 1 台电脑上登录。需要多台电脑一起用、或想让配置自动跟着账号走，可以开通会员。"
      onClose={closeMemberIntro}
      footer={
        <>
          <Button variant="ghost" onClick={closeMemberIntro}>
            先用免费版
          </Button>
          <Button onClick={goMember}>看看会员权益</Button>
        </>
      }
    >
      <BenefitTable plans={plans} />
    </Dialog>
  );
}
