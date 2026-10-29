// 根组件：主题 Provider + 闸门顺序：强制升级（盖住一切）→ 登录 / 设备名额已满 → 主界面。
import { AdminProvider, NotificationProvider, PanelErrorBoundary } from "@ankotti/admin-ui";
import { useCallback, useState } from "react";
import { LoginScreen } from "../features/account/login-screen";
import { MemberGate } from "../features/account/member-gate";
import { useStore } from "../shared/store";
import { license } from "../state/account";
import { data } from "../state/data";
import { ForcedUpdateDialog } from "./forced-update";
import { GateFrame } from "./gate-frame";
import { MainShell } from "./main-shell";
import { nav } from "./nav";
import { asMode, BRAND_INK, useResolvedDark } from "./theme";
import { useAppLifecycle } from "./use-app-lifecycle";
import { useFeedback } from "./use-feedback";
import "./app.css";

// 每秒定时器里判断「是否在日志页」（日志页才拉实时连接）。
const isLogsPage = () => ["logs", "flows", "overview"].includes(nav.get().page);
const isOverview = () => nav.get().page === "overview";

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
  useAppLifecycle(say, isLogsPage, setNetBlocked, isOverview);

  const status = useStore(license, (s) => s.status);
  // 免费用户功能齐全，直接进主界面；会员闸门只在设备名额满了（要先解绑旧设备）时出现。
  let body = <MainShell netBlocked={netBlocked} onDismissNetBlocked={dismissNetBlocked} />;
  if (status.enabled && status.signedIn && status.deviceLimitReached)
    body = (
      <GateFrame>
        <MemberGate netBlocked={netBlocked} onDismissNetBlocked={dismissNetBlocked} />
      </GateFrame>
    );
  else if (status.enabled && !status.signedIn && !status.authenticated)
    body = (
      <GateFrame>
        <LoginScreen />
      </GateFrame>
    );
  return (
    <>
      <ForcedUpdateDialog />
      {body}
    </>
  );
}
