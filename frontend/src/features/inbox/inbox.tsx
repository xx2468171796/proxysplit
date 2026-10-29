// 消息中心：公司统一通知包 tongzhi 的玩家端组件（铃铛 + 横幅 / 弹窗 / 右下角提示）。
// 桌面端没有同源 HTTP：tongzhi 客户端的 fetch 换成 Go 绑定 TongzhiCall，由 Go 带登录凭证转发到 /v1/tongzhi（路径白名单在 Go 侧）。
import { type ReactNode, useMemo } from "react";
import { createTongzhiClient } from "tongzhi/client";
import { TongzhiBell, TongzhiProvider, TongzhiSurfaces } from "tongzhi/react";
import "tongzhi/react/styles.css";
import * as W from "../../../wailsjs/go/main/App.js";
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime.js";
import { useStore } from "../../shared/store";
import { license } from "../../state/account";

const BASE = "tz:";

/** fetch 形状的适配器：只取方法、子路径和正文，交给 Go。 */
const viaGo: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : null;
  const url = req ? req.url : String(input);
  const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
  const body = typeof init?.body === "string" ? init.body : req ? await req.text() : "";
  const r = await W.TongzhiCall(init?.method ?? req?.method ?? "GET", path, body);
  if (!r.status) throw new Error(r.err || "网络不可用");
  const payload = r.body ?? { code: "ERROR", message: r.err || `HTTP ${r.status}` };
  return new Response(JSON.stringify(payload), { status: r.status, headers: { "content-type": "application/json" } });
};

/** 通知里的按钮：外部链接用系统浏览器打开，站内路径在桌面端没有对应页面，忽略。 */
const openLink = (url: string) => {
  if (/^https?:\/\//i.test(url)) BrowserOpenURL(url);
};

export function InboxProvider({ children }: { children: ReactNode }) {
  const signedIn = useStore(license, (s) => s.status.signedIn);
  const client = useMemo(() => createTongzhiClient({ base: BASE, fetch: viaGo }), []);
  return (
    <TongzhiProvider
      client={client}
      theme="light-clean"
      rootClassName="ps-tz"
      enabled={signedIn}
      navigate={openLink}
      centerUrl={null}
    >
      {children}
      <TongzhiSurfaces />
    </TongzhiProvider>
  );
}

export function InboxBell() {
  const signedIn = useStore(license, (s) => s.status.signedIn);
  return signedIn ? <TongzhiBell /> : null;
}
