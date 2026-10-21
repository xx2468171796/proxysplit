import "@ankotti/admin-ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./site/tokens.css";
import "./site.css";
import { App } from "./app";
import { SiteRoot } from "./site/site-root";

// front-site 配方接线：admin-ui 核心样式必须是第一行 import；tokens.css 是全站颜色唯一来源。
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("缺少 #root 挂载点");
createRoot(rootElement).render(
  <StrictMode>
    <SiteRoot>
      <App />
    </SiteRoot>
  </StrictMode>,
);
