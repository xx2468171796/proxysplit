// 页面顶部横幅：分流没生效（可忽略，内容变了再出现）、开代理后连不上网、拆单付了一部分还没付完。新版本由 ForcedUpdateDialog 整屏处理。
import { InlineAlert } from "@ankotti/admin-ui";
import { useState } from "react";
import { ResumeOrderAlert } from "../features/account/resume-order-alert";
import { useStore } from "../shared/store";
import { runtime } from "../state/runtime";

type Props = { netBlocked: string; onDismissNetBlocked: () => void };

export function NetBlockedBanner({ netBlocked, onDismissNetBlocked }: Props) {
  if (!netBlocked) return null;
  return (
    <InlineAlert banner tone="error" title="开代理后连不上网" onClose={onDismissNetBlocked}>
      {netBlocked}
    </InlineAlert>
  );
}

export function Banners(props: Props) {
  const warning = useStore(runtime, (s) => s.health.warning);
  const [dismissed, setDismissed] = useState("");
  return (
    <>
      <NetBlockedBanner {...props} />
      <ResumeOrderAlert banner />
      {warning && warning !== dismissed ? (
        <InlineAlert banner tone="warning" title="分流没生效" onClose={() => setDismissed(warning)}>
          {warning}
        </InlineAlert>
      ) : null}
    </>
  );
}
