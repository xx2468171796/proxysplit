// 根组件：主题 Provider + 闸门顺序：强制升级（盖住一切）→ 登录 / 会员闸门 → 主界面。
import { AdminProvider, NotificationProvider, PanelErrorBoundary } from "@ankotti/admin-ui";
import { useCallback, useState, useSyncExternalStore } from "react";
import { LoginScreen } from "../features/account/login-screen";
import { MemberGate } from "../features/account/member-gate";
import { useStore } from "../shared/store";
import { license } from "../state/account";
import { data } from "../state/data";
import { ForcedUpdateDialog } from "./forced-update";
import { MainShell } from "./main-shell";
import { nav } from "./nav";
import { useAppLifecycle } from "./use-app-lifecycle";
import { useFeedback } from "./use-feedback";
import "./app.css";

/**
 * 品牌主色：近黑的墨色（业主 2026-10-22）。组件库在深色模式下会把主色再压暗做按钮底色，
 * 近黑会和深色面板糊在一起，所以深色模式换一档偏亮的石墨色。
 */
const BRAND_INK = { light: "#1c1f24", dark: "#6b7584" } as const;
type Mode = "light" | "dark" | "system";
const asMode = (t: string): Mode => (t === "dark" || t === "system" ? t : "light");
// 每秒定时器里判断「是否在日志页」（日志页才拉实时连接）。
const isLogsPage = () => nav.get().page === "logs";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const subscribeScheme = (fn: () => void) => {
  const mq = matchMedia(DARK_QUERY);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
};

/** 主题只认设置页的「主题」（settings.theme），「跟随」时跟着系统变。 */
function useResolvedDark(mode: Mode): boolean {
  const systemDark = useSyncExternalStore(subscribeScheme, () => matchMedia(DARK_QUERY).matches);
  return mode === "dark" || (mode === "system" && systemDark);
}

export function App() {
  const mode = asMode(useStore(data, (s) => s.settings.theme));
  const dark = useResolvedDark(mode);
  return (
    <AdminProvider
      storageKey="proxysplit:ui"
      mode={mode}
      pointer="fine"
      // 业主 2026-10-22：主色偏黑、不要背景光晕；动效用沉稳档 + 柔圆细阴影，提高级感。
      palette={dark ? BRAND_INK.dark : BRAND_INK.light}
      ambient="none"
      motionStyle="calm"
      look={{ radius: "soft", surface: "elevated", signature: "none" }}
      defaults={{ timeZone: "Asia/Shanghai", currency: "CNY" }}
    >
      <NotificationProvider>
        {/* 最后一道兜底：外壳 / 闸门 / 弹窗渲染出错时显示「重试」，不白屏。 */}
        <PanelErrorBoundary>
          <Root />
        </PanelErrorBoundary>
      </NotificationProvider>
    </AdminProvider>
  );
}

function Root() {
  const { say } = useFeedback();
  // 开代理后连不上网（多半被安全软件拦截）：常驻到用户点「知道了」。
  const [netBlocked, setNetBlocked] = useState("");
  const dismissNetBlocked = useCallback(() => setNetBlocked(""), []);
  useAppLifecycle(say, isLogsPage, setNetBlocked);

  const status = useStore(license, (s) => s.status);
  const gated = status.enabled && !status.authenticated;
  let body = <MainShell netBlocked={netBlocked} onDismissNetBlocked={dismissNetBlocked} />;
  if (gated && status.signedIn) body = <MemberGate netBlocked={netBlocked} onDismissNetBlocked={dismissNetBlocked} />;
  else if (gated) body = <LoginScreen />;
  return (
    <>
      <ForcedUpdateDialog />
      {body}
    </>
  );
}
