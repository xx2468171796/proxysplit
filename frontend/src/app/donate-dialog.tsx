// 赞赏码：每次启动弹出，先停留 3 秒（期间不能关），之后只能手动点关闭，不会自动消失。
// 中转站渠道的客户不弹；需要登录的版本只在启动时已通过授权才弹。
import { Button, Dialog, DialogFooter, Note } from "@ankotti/admin-ui";
import { useEffect, useState } from "react";
import donateQR from "../assets/images/donate.png";
import { useStore } from "../shared/store";
import { isAigwChannel, license } from "../state/account";
import { data } from "../state/data";
import { updateNotes } from "./update-notes-dialog";

const WAIT_SECONDS = 3;

export function DonateDialog() {
  const dataLoaded = useStore(data, (s) => s.loaded);
  const notesSettled = useStore(updateNotes, (s) => s.settled);
  const loaded = dataLoaded && notesSettled;
  const status = useStore(license, (s) => s.status);
  const eligible = !isAigwChannel(status) && (!status.enabled || status.authenticated);
  const [shown, setShown] = useState<"pending" | "open" | "closed">("pending");
  const [left, setLeft] = useState(WAIT_SECONDS);

  // 只在首屏数据到达时判断一次（同旧版）：启动时没过授权的，之后登录 / 付款成功也不再打断。
  useEffect(() => {
    if (shown === "pending" && loaded) setShown(eligible ? "open" : "closed");
    if (shown === "open" && isAigwChannel(status)) setShown("closed");
  }, [loaded, eligible, shown, status]);

  useEffect(() => {
    if (shown !== "open" || left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [shown, left]);

  if (shown !== "open") return null;
  const close = () => {
    if (left <= 0) setShown("closed");
  };
  return (
    <Dialog
      open
      size="sm"
      title="支持一下作者"
      onClose={close}
      // 倒计时期间不给右上角关闭按钮
      header={(closeButton) => (
        <header className="aui-dialog-header">
          <div className="aui-header-text">
            <div className="aui-dialog-title">支持一下作者</div>
          </div>
          {left > 0 ? null : closeButton}
        </header>
      )}
      footer={
        <DialogFooter>
          <Button disabled={left > 0} onClick={close}>
            {left > 0 ? `请欣赏 ${left}s…` : "我知道了，关闭"}
          </Button>
        </DialogFooter>
      }
    >
      <div className="ps-qr-tile">
        <img src={donateQR} alt="微信赞赏码" width={220} height={220} />
      </div>
      <Note as="p" className="ps-center">
        微信扫码赞赏，您的支持是我持续开发的最大动力
      </Note>
    </Dialog>
  );
}
