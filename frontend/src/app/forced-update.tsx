// 强制升级：版本标了 mandatory 时整屏拦住、不可关闭，登录 / 会员闸门之外同样生效。
import { Button, Dialog, DialogFooter, Note } from "@ankotti/admin-ui";
import { useStore } from "../shared/store";
import { appUpdate, installAppUpdate } from "../state/update";
import { useFeedback } from "./use-feedback";

const TITLE = "需要升级后才能继续使用";

export function ForcedUpdateDialog() {
  const { say } = useFeedback();
  const info = useStore(appUpdate, (s) => s.info);
  const busy = useStore(appUpdate, (s) => s.busy);
  const release = info.available ? info.release : undefined;
  if (!release?.mandatory) return null;
  return (
    <Dialog
      open
      title={TITLE}
      size="sm"
      onClose={() => undefined}
      header={() => (
        <header className="aui-dialog-header">
          <div className="aui-header-text">
            <div className="aui-dialog-title">请升级到 v{release.version}</div>
          </div>
        </header>
      )}
      footer={
        <DialogFooter>
          <Button loading={busy} loadingText="下载并验证中…" onClick={() => void installAppUpdate().then(say)}>
            立即安全升级
          </Button>
        </DialogFooter>
      }
    >
      <Note as="p">
        {busy
          ? "正在自动下载并安装，完成后软件会自动重启，代理会自动恢复。"
          : `当前版本 v${info.current} 已停止支持，需完成升级后才能继续使用。`}
      </Note>
      <Note as="p">升级包已通过 Ed25519 签名与 SHA256 双重校验，不会改动你的节点与规则。</Note>
    </Dialog>
  );
}
