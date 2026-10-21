import "@ankotti/admin-ui/styles.css";
import "@ankotti/admin-ui/motion.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";

async function start(): Promise<void> {
  // 浏览器里 `vite dev` 预览时没有 Wails，换成假后端；打包时整段被摇掉。
  if (import.meta.env.DEV && !("go" in window)) {
    const { installMockBackend } = await import("./dev/mock-backend");
    installMockBackend();
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
