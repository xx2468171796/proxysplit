import "@ankotti/admin-ui/styles.css";
import "@ankotti/admin-ui/motion.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";

/**
 * 浏览器里 `vite dev` 预览时没有 Wails，换成假后端；正式构建时整段被摇掉。
 * `VITE_MOCK=1 vite build` 产出带假后端的静态评审包（给人看界面用，不进安装包；正式构建不设这个变量）。
 */
const MOCK = import.meta.env.DEV || import.meta.env.VITE_MOCK === "1";

async function start(): Promise<void> {
  if (MOCK && !("go" in window)) {
    const [{ installMockBackend }, { applyPreviewParams }] = await Promise.all([
      import("./dev/mock-backend"),
      import("./dev/preview-params"),
    ]);
    installMockBackend();
    applyPreviewParams();
  }
  const root = document.getElementById("root");
  if (!root) throw new Error("#root missing");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
