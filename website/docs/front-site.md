# 官网：qiantai 站点配方

官网（https://proxysplit.zygskins.cn/ ，和商业 API `/v1/*` 同域）用公司前台标准 **qiantai**（`package.json` 钉
`qiantai-v0.8.0`）：整页 = 一份**站点配方**（行业底稿 + 主色 + 设计语言 + 动效方案 + 区块列表），
由 `<SiteView recipe actions slots>` 一次渲染。颜色只来自主题（adminUI 色卡算出的 `--q-*` 变量），动效只来自 dongxiao。
接入手册：`node_modules/qiantai/INTEGRATION.md`；能力清单：`node_modules/qiantai/src/catalog.ts`。

## 代码在哪

| 文件 | 作用 |
|---|---|
| `src/recipe.ts` | **配方**：`siteRecipe(version, dark)`。行业 `saas`、设计语言 `clean-modern`、主色浅色 `#1c1f24` / 深色 `#6b7584`（和客户端一致）、动效方案 `calm` + 强度 `normal`（首屏线波是 Canvas 2D，不建 WebGL）。全部文案和区块顺序都在这里 |
| `src/app.tsx` | `parseRecipe` 校验后交给 `SiteView`；`ACTIONS`（按钮 / 导航 / 页脚文字 → 去哪）；`slots`（实时内容） |
| `src/slots/` | 插槽内容：`shot.tsx`（截图窗口框 + 首屏下大图 `preview`）、`tour.tsx`（`features`：文字 + 真截图）、`pricing.tsx` / `plan-card.tsx`（`pricing`：套餐 + 网页注册）、`download.tsx`（`download`：最新版本 + 联系方式） |
| `src/api.ts` / `src/use-site-data.ts` | 和 `/v1` 的全部往来：访客 ID、`trackView`、`fetchLatestVersion`、`fetchPlans`、`registerWeb`，`LATEST_DOWNLOAD`（带访客统计的下载地址） |
| `src/site.css` | 插槽样式，只读 `--q-*`（0.6.0 时的几处样式补丁已在 qiantai 0.8.0 里从源头修掉、删除） |
| `src/dev/mock-api.ts` | 假接口，只在开发预览和评审包里装（见下） |
| `public/shots/` | 客户端 v1.9.80 新界面截图：`<名字>.webp`（1x）+ `@2x.webp`，名字和尺寸登记在 `src/slots/shot.tsx` 的 `SHOTS` |

## actions 和 slots 怎么用

- **配方只写文字**。按钮 / 导航 / 页脚点了去哪，在 `app.tsx` 的 `ACTIONS` 里按**文字**对应（文字统一放在 `recipe.ts` 的 `LABEL`）：
  下载类 → `LATEST_DOWNLOAD`，导航 → 区块锚点（`#features` `#pricing` `#faq` `#notice` `#download`）。改按钮文字要两边一起改，没配的按钮 qiantai 会让它点了没反应。
- **实时内容放插槽**：配方里写 `{ t: "slot", id: "pricing" }`，`app.tsx` 的 `slots.pricing` 给 React 内容；插槽自带锚点 `#<id>`。
  价格、版本号这类接口数据一律走插槽，**不写进配方**。插槽里用 qiantai 导出的 `Section` / `Card` / `Enter` 和 `q-btn` / `q-input` / `q-card` / `q-chip` 类，颜色只写 `var(--q-…)`。
- 任何区块可带 `id` 当锚点（如 `notice`、`faq`）。
- 加新区块先看 `blockSchema`（`node_modules/qiantai/src/blocks/schema.ts`）；`pnpm check:recipe` 会用 `parseRecipe` 校验配方（四种组合，预算提醒也算失败）。

## 本地预览与假接口

- `pnpm dev`（5288）：`/v1/*` 默认由假接口接住。地址参数切状态：`?plans=loading|error|empty`、`?register=fail`、`?version=none`、`?theme=dark`；
  `?mock=0` 改走 vite 代理的线上接口。访问统计在开发环境不上报。
- 正式构建（`pnpm build` / `check:bundle`）里假接口那一支被常量折叠掉，产物里没有假数据。

## 评审包（页面审阅台 yemian）

审阅台用 `sandbox` iframe（没有 allow-same-origin）加载页面：分文件的 Vite 产物会因跨域整页空白，同域 fetch 也会失败。所以评审包是**单文件页**：

```bash
pnpm --dir website review D:/tmp/site-review
```

做了什么：`vite.review.config.ts`（mergeConfig 叠在正式配置上：`base: "./"`、资源全转 data URL、单 chunk、CSS 不拆、不预加载）+ `.env.review`（`VITE_MOCK=1` 装假接口）
构建到 `node_modules/.review-build`，再由 `scripts/review-pages.mjs` 把 JS / CSS / `public` 里的截图和图标内联进 HTML。
输出 `home-desktop.html`（浅色整页）、`home-dark.html`（深色备选）和 `items.json`。地址参数在沙箱里改不了，改由页面里的 `window.__PS_QUERY` 传（`src/query.ts`）。
加评审画面：改 `review-pages.mjs` 的 `PAGES` 和 `items`。

## 门禁

`pnpm --dir website check` = typecheck → biome → 文件体量 → 配方校验 → 首屏体积（`xingneng bundle`：JS ≤ 300 KB / CSS ≤ 40 KB gzip）。
超了把重的东西挪进懒加载块，**别调高预算**。`vite.config.ts` 的重依赖分块关了「连带依赖」（`includeDependenciesRecursively: false`），
否则 react 会被拉进 gsap 块、首屏反过来静态 import gsap。

## 换截图

客户端 `frontend` 的 mock 预览（`pnpm dev`，`?donate=0&page=apps|nodes`、`?look=1`），1400×900 视口按 1x / 2x 各拍一份转 webp（质量 82），
覆盖 `public/shots/` 同名文件；尺寸变了同步 `shot.tsx` 的 `SHOTS` 和 `index.html` 的预加载。

## 升级

1. 查最新 tag：`git ls-remote --tags --refs http://s3.alonelife.top:32109/admin/yanzheng.git "qiantai-v*" "dongxiao-v*" "adminUI-v*"`。
2. 改 `package.json` 的 `#<tag>`；`@ankotti/admin-ui` 必须和 `frontend/` 钉同一个 tag（admin-ui-audit `split-version`）。
3. `pnpm install` → `pnpm check` → `pnpm dev` 看一遍；如果 qiantai 修了 `site.css` 里注明的问题，删掉对应补丁。版本变更（package.json + lockfile）单独提交。

## 版权红线

dongxiao（qiantai 的动效来源）源自 React Bits（MIT + Commons Clause）：只能作为公司自己产品的一部分使用。
站点照常上线没问题；**永远不要**把 dongxiao / qiantai 发到公共 npm、单独再分发，或把源码拷进公开仓库。
