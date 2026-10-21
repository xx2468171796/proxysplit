// 页面顶部横幅：发现新版本、分流没生效（可忽略，内容变了再出现）、开代理后连不上网。
import { Button, InlineAlert } from "@ankotti/admin-ui";
import { useState } from "react";
import { useStore } from "../shared/store";
import { runtime } from "../state/runtime";
import { appUpdate, installAppUpdate } from "../state/update";
import { useFeedback } from "./use-feedback";

type Props = { netBlocked: string; onDismissNetBlocked: () => void };

export function UpdateBanner() {
  const { say } = useFeedback();
  const info = useStore(appUpdate, (s) => s.info);
  const busy = useStore(appUpdate, (s) => s.busy);
  const release = info.available ? info.release : undefined;
  if (!release || release.mandatory) return null;
  return (
    <InlineAlert
      banner
      tone="info"
      title={`发现新版本 v${release.version}`}
      action={
        <Button size="sm" loading={busy} loadingText="下载并验证中…" onClick={() => void installAppUpdate().then(say)}>
          立即安全升级
        </Button>
      }
    >
      当前 v{info.current} · 升级包已通过 Ed25519 签名与 SHA256 双重校验
    </InlineAlert>
  );
}

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
      <UpdateBanner />
      {warning && warning !== dismissed ? (
        <InlineAlert banner tone="warning" title="分流没生效" onClose={() => setDismissed(warning)}>
          {warning}
        </InlineAlert>
      ) : null}
    </>
  );
}
