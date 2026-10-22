// 登录 / 会员闸门的窗口外框：Wails 无边框窗口没有系统标题栏，这两个画面不在主外壳里，
// 用 qiantai DesktopFrame 补上标题栏和自绘窗口按钮，否则窗口拖不动也关不掉。
import { DesktopFrame } from "qiantai/desktop";
import type { ReactNode } from "react";
import logo from "../assets/proxysplit-logo.svg";
import { useStore } from "../shared/store";
import { data } from "../state/data";
import { asMode, desktopLook, useResolvedDark } from "./theme";
import { useWindowControls } from "./window-controls";

export function GateFrame({ children }: { children: ReactNode }) {
  const dark = useResolvedDark(asMode(useStore(data, (s) => s.settings.theme)));
  const look = desktopLook(dark);
  const windowControls = useWindowControls();
  if (!look) return children;
  return (
    <DesktopFrame
      look={look}
      windowControls={windowControls}
      title={
        <span className="ps-title">
          <img src={logo} alt="" className="ps-logo" />
          ProxySplit
        </span>
      }
    >
      {children}
    </DesktopFrame>
  );
}
