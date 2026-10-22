// 评审包专用：页面审阅台用沙箱 iframe（无 allow-same-origin）加载页面，分开的 JS 模块跨域加载会失败。
// 打成一个 chunk、资源全转 data URL，再由 scripts/review-pages.mjs 内联成单文件页。正式构建不用它。
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    build: {
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }),
);
