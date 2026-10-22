// 评审包：VITE_MOCK=1 用 vite.review.config.ts 构建后，把 JS / CSS 内联成每个评审画面一个单文件页（页面审阅台沙箱里能直接跑）
// 用法：node scripts/review-pages.mjs <构建目录> <输出目录>
import fs from "node:fs";
import path from "node:path";

const [, , buildDir, outDir] = process.argv;
let html = fs.readFileSync(path.join(buildDir, "index.html"), "utf8");
const read = (rel) => fs.readFileSync(path.join(buildDir, rel), "utf8");

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_, rel) => `<style>${read(rel)}</style>`);
const scripts = [];
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (_, rel) => {
  scripts.push(read(rel).replaceAll("</script", "<\\/script"));
  return "";
});
html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");

const pages = {
  "overview-light.html": "?donate=0",
  "overview-dark.html": "?donate=0&theme=dark",
  "apps.html": "?donate=0&page=apps",
  "nodes.html": "?donate=0&page=nodes",
  "settings.html": "?donate=0&page=settings",
  "appearance.html": "?donate=0&look=1",
};
fs.mkdirSync(outDir, { recursive: true });
for (const [file, query] of Object.entries(pages)) {
  // 沙箱里改不了地址：预览参数写进 __PS_QUERY（src/dev/search.ts 读它）
  const boot = `<script>window.__PS_QUERY=${JSON.stringify(query)}</script>`;
  const body = `${boot}<script type="module">${scripts.join("\n")}</script>`;
  fs.writeFileSync(path.join(outDir, file), html.replace("</body>", () => `${body}</body>`));
}
console.log("pages", Object.keys(pages).length, "bytes", fs.statSync(path.join(outDir, "apps.html")).size);
