import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { captureReferralCode } from "./api";
import { App } from "./app";
// 插槽样式放在 qiantai 样式之后（同权重时后者胜）
import "./site.css";

// 假接口：开发预览（dev）和评审包（VITE_MOCK=1）才装；正式构建这一支被常量折叠掉，假数据不进产物。
if (import.meta.env.DEV || import.meta.env.VITE_MOCK === "1") {
  const { installMockApi } = await import("./dev/mock-api");
  installMockApi();
}

captureReferralCode();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("缺少 #root 挂载点");
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
