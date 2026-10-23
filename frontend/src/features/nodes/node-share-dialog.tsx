// 分享节点：默认给分享链接（vless:// ss:// …，复制后在别的客户端「从剪贴板导入」），二维码按需展开。
// 后端给的二维码是 PNG data-URI，只能用 <img> 展示（QrCode 组件只会从文本生成）。
import { Button, Dialog, FormField, Note, Textarea } from "@ankotti/admin-ui";
import { Copy, QrCode } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/backend";
import { useFeedback } from "../../app/use-feedback";

export type NodeShare = { name: string; link: string; qr: string };

export function NodeShareDialog({ share, onClose }: { share: NodeShare; onClose: () => void }) {
  const { say } = useFeedback();
  const [showQR, setShowQR] = useState(false);
  const copy = () => void api.copyToClipboard(share.link).then(() => say("已复制分享链接"));
  return (
    <Dialog open size="sm" title="分享节点" description={share.name} onClose={onClose}>
      <FormField label="分享链接" htmlFor="node-share-link">
        <Textarea id="node-share-link" value={share.link} readOnly rows={4} onFocus={(e) => e.currentTarget.select()} />
      </FormField>
      <div className="ps-share-actions">
        <Button size="sm" onClick={copy}>
          <Copy />
          复制链接
        </Button>
        {/* 链接太长生成不了二维码时后端给空 qr：只分享链接 */}
        {share.qr ? (
          <Button size="sm" variant="outline" onClick={() => setShowQR((v) => !v)}>
            <QrCode />
            {showQR ? "收起二维码" : "显示二维码"}
          </Button>
        ) : null}
      </div>
      {showQR && share.qr ? (
        <div className="ps-qr-tile">
          <img src={share.qr} alt={`${share.name} 的二维码`} width={220} height={220} />
        </div>
      ) : null}
      <Note as="p" className="ps-center">
        复制链接发给对方，在客户端里「从剪贴板导入」即可；手机也可以扫二维码。链接里含节点密码，只发给信任的人。
      </Note>
    </Dialog>
  );
}
