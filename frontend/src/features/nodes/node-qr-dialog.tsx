// 分享节点：后端给的是 PNG data-URI，只能用 <img> 展示（QrCode 组件只会从文本生成）。
import { Dialog, Note } from "@ankotti/admin-ui";

export type NodeQR = { name: string; data: string };

export function NodeQRDialog({ qr, onClose }: { qr: NodeQR; onClose: () => void }) {
  return (
    <Dialog open size="sm" title="分享节点" description={qr.name} onClose={onClose}>
      <div className="ps-qr-tile">
        <img src={qr.data} alt={`${qr.name} 的二维码`} width={220} height={220} />
      </div>
      <Note as="p" className="ps-center">
        用另一台设备的客户端扫码即可导入该节点
      </Note>
    </Dialog>
  );
}
