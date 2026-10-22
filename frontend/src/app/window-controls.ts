// 自绘窗口按钮（Wails 无边框窗口，业主 2026-10-23：不用系统标题栏）：最小化 / 最大化·还原 / 关闭。
// 关闭走 Quit()：Wails 会先问 Go 的 OnBeforeClose（tray.go beforeClose：已登录且开了「关闭收到托盘」就隐藏，否则退出），和以前点系统 × 一样。
// 浏览器预览（没有 Wails 运行时）里按钮什么都不做。
import type { WindowControls } from "qiantai/desktop";
import { useEffect, useMemo, useState } from "react";
import { Quit, WindowIsMaximised, WindowMinimise, WindowToggleMaximise } from "../../wailsjs/runtime/runtime.js";

// 有 Wails 窗口接口才调（浏览器预览的假后端只假了事件，没有窗口方法）
const inWails = () =>
  typeof (window as { runtime?: { WindowMinimise?: unknown } }).runtime?.WindowMinimise === "function";
const ifWails = (fn: () => void) => () => {
  if (inWails()) fn();
};

export function useWindowControls(): WindowControls {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!inWails()) return;
    let alive = true;
    const sync = () =>
      void WindowIsMaximised().then((m) => {
        if (alive) setMaximized(m);
      });
    sync();
    // 最大化 / 还原 / 拖到屏幕边缘吸附都会改窗口大小
    window.addEventListener("resize", sync);
    return () => {
      alive = false;
      window.removeEventListener("resize", sync);
    };
  }, []);
  return useMemo(
    () => ({
      onMinimize: ifWails(WindowMinimise),
      onToggleMaximize: ifWails(WindowToggleMaximise),
      onClose: ifWails(Quit),
      maximized,
      toggleOnDoubleClick: true,
    }),
    [maximized],
  );
}
