import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Wails 把 dist 嵌进 exe，用相对路径加载资源。
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { forwardConsole: true },
});
