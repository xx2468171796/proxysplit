import { AdminProvider } from "@ankotti/admin-ui";
import type { ReactNode } from "react";

import { MotionProvider } from "./motion-context.tsx";
import { ThemeProvider, useTokens } from "./theme-provider.tsx";
import { DEFAULT_THEME, type ThemeName } from "./tokens.ts";

/** admin-ui 的外观偏好前缀，每个项目一个 */
const STORAGE_KEY = "proxysplit-website:site";

/** admin-ui 控件（按钮 / 表单 / 弹窗）的色卡跟站点品牌色走：palette 直接吃 tokens.css 里的 --brand */
function AdminBridge({ theme, children }: { theme: ThemeName; children: ReactNode }) {
  const tokens = useTokens();
  return (
    <AdminProvider storageKey={STORAGE_KEY} palette={tokens.brand} mode={theme}>
      {children}
    </AdminProvider>
  );
}

interface SiteRootProps {
  theme?: ThemeName;
  children: ReactNode;
}

/** 前台站点的外层：主题令牌 → admin-ui → 全站动效总闸 */
export function SiteRoot({ theme = DEFAULT_THEME, children }: SiteRootProps) {
  return (
    <ThemeProvider theme={theme}>
      <AdminBridge theme={theme}>
        <MotionProvider>{children}</MotionProvider>
      </AdminBridge>
    </ThemeProvider>
  );
}
