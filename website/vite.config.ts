import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { bundleModules, precompress } from "xingneng/vite";

/**
 * front-site 配方：3D / 动画 / 图表重依赖各自单独成块（chunk 名 heavy-<包名>）。
 * 首屏门禁 `xingneng bundle` 靠 bundleModules() 的模块清单就能认出合进别的块的重依赖；单独成块是为了
 * 懒加载时按需下载、缓存互不影响，也让 dist 里一眼看出谁重。
 */
const HEAVY_MODULE =
  /[\/]node_modules[\/](three|@react-three[\/][\w-]+|ogl|gsap|@gsap[\/][\w-]+|matter-js|postprocessing|maath|troika-[\w-]+|echarts|zrender)[\/]/;

export default defineConfig({
  plugins: [
    react(),
    bundleModules(),
    precompress({ brotli: false }),
  ],
  // 首屏门禁（pnpm check:bundle → xingneng bundle）读 dist/.vite/manifest.json；nginx 不对外暴露 /.vite/
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: (id) => {
                const pkg = HEAVY_MODULE.exec(id)?.[1];
                return pkg ? `heavy-${pkg.replace(/[@\/]+/g, "-").replace(/^-/, "")}` : null;
              },
              test: HEAVY_MODULE,
            },
          ],
        },
      },
    },
  },
  server: {
    // 本地预览直接读线上接口（套餐、版本号）；访问统计在开发环境不上报。
    proxy: { "/v1": { target: "https://proxysplit.zygskins.cn", changeOrigin: true } },
    // Vite 8：把浏览器控制台转发到终端，AI 在命令行就能看到前端报错，不用截图 / 开 DevTools
    forwardConsole: true,
  },
});
