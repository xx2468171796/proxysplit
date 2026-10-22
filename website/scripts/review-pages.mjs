// 评审包：VITE_MOCK=1 用 vite.review.config.ts 构建后，把 JS / CSS / 图片内联成每个评审画面一个单文件页（页面审阅台沙箱里能直接跑）。
// 用法：node scripts/review-pages.mjs <构建目录> <输出目录>（pnpm review 一步做完）
import fs from "node:fs";
import path from "node:path";

const [, , buildDir, outDir] = process.argv;
if (!buildDir || !outDir) throw new Error("用法：node scripts/review-pages.mjs <构建目录> <输出目录>");
const read = (rel) => fs.readFileSync(path.join(buildDir, rel), "utf8");

// public/ 里的图片（截图、图标）代码里写的是 /shots/x.webp、/favicon.svg 这样的字面量，换成 data URL
const MIME = { ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
function inlinePublic(text) {
  // 前面可能带 base 的「.」（index.html 里是 ./favicon.svg），一起换掉
  return text.replace(/\.?\/(?:shots\/[\w@.-]+\.webp|favicon\.svg)/g, (rel) => {
    const file = path.join(buildDir, rel.replace(/^\./, ""));
    if (!fs.existsSync(file)) return rel;
    return `data:${MIME[path.extname(file)]};base64,${fs.readFileSync(file).toString("base64")}`;
  });
}

// 替换一律传函数：压缩后的 JS 里有 $' / $& 之类，传字符串会被 String.replace 当成特殊替换展开
let html = read("index.html");
html = html.replace(/<link rel="(?:preload|manifest|canonical)"[^>]*>/g, () => "");
html = html.replace(/<link rel="modulepreload"[^>]*>/g, () => "");
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_, rel) => `<style>${read(rel)}</style>`);
const scripts = [];
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (_, rel) => {
  scripts.push(read(rel).replaceAll("</script", "<\\/script"));
  return "";
});
if (!scripts.length) throw new Error("构建产物里没找到入口脚本，确认用的是 vite.review.config.ts（base ./）");
html = inlinePublic(html);
const js = inlinePublic(scripts.join("\n"));

/** 评审画面：文件名 → 地址参数（沙箱里改不了地址，页面从 window.__PS_QUERY 读，见 src/query.ts） */
const PAGES = {
  "home-desktop.html": "",
  "home-dark.html": "?theme=dark",
};
fs.mkdirSync(outDir, { recursive: true });
for (const [file, query] of Object.entries(PAGES)) {
  const body = `<script>window.__PS_QUERY=${JSON.stringify(query)}</script><script type="module">${js}</script>`;
  fs.writeFileSync(path.join(outDir, file), html.replace("</body>", () => `${body}</body>`));
}

const items = [
  {
    no: "1",
    file: "home-desktop.html",
    title: "官网首页（浅色，qiantai 重写）",
    desc: "整页从上往下看：首屏标题与下载按钮、客户端新界面截图（无边框，标题栏右端是我们自己的最小化 / 最大化 / 关闭按钮，外面只套圆角卡片、不再画 Windows 窗口框）、协议条、功能三段（应用分流 / 测速 / 外观）、更多功能、四步上手、会员套餐与网页注册、使用须知、常见问题、下载与联系方式、页脚。套餐和版本号是预览用的假数据。重点看排版、对比度、按钮和导航是否都能点。",
  },
  {
    no: "2",
    file: "home-dark.html",
    title: "官网首页（深色备选）",
    desc: "同一份配方切深色（主色 #6b7584，和客户端深色一致），线上默认仍是浅色。看深色下文字、按钮、卡片边线是否清楚；截图仍是浅色界面。",
  },
];
fs.writeFileSync(path.join(outDir, "items.json"), `${JSON.stringify(items, null, 2)}\n`);
const size = fs.statSync(path.join(outDir, "home-desktop.html")).size;
console.log(`评审包：${Object.keys(PAGES).length} 页 → ${outDir}（单页 ${(size / 1024).toFixed(0)} KB）`);
