# 前台站点：特效与组件（front-site 配方生成）

本项目的前台页面（营销页 / 游戏站 / 落地页 / 官网）用两样公司件：

- **dongxiao** —— 前台特效（React Bits 全量 216 个 + 动效纪律引擎），只限内部；
- **@ankotti/admin-ui** —— 按钮、表单、弹窗、表格等基础控件（前台同样用它，不再用 shadcn）。

两者都在 `./package.json` 里钉了内部 Gitea 的固定 tag。代码在 `./src/site/`：

| 文件 | 作用 |
|---|---|
| `tokens.css` | 设计令牌：全站颜色**唯一来源**（浅色 / 深色两套） |
| `tokens.ts` / `theme-provider.tsx` | 令牌名清单、默认主题；`useTokens()` 把具体色值交给 dongxiao 组件当 props |
| `site-root.tsx` | 外层：主题 → `AdminProvider`（色卡 = `--brand`）→ 动效总闸 |
| `motion-context.tsx` | 全站动效总闸 `useMotion().paused / setPaused` |
| `lazy-effect.tsx` / `webgl-support.ts` | 首屏以下重特效挂载器：进视口才下载；减少动态效果 / 无 WebGL 只给静态层，连 chunk 都不下 |
| `landing-page.tsx` / `aurora-section.tsx` / `aurora-scene.tsx` / `landing.css` | 示例落地页：首屏 2D 背景 + 文字特效 + admin-ui 按钮，卡片特效，首屏以下懒加载的 WebGL 区块 |

## 怎么挑特效

1. **看效果**：画廊 https://dongxiao.zygskins.cn （公司内网免登录，外网登录账号在堡垒机资产「dongxiao 特效画廊 · 登录账号」；内部资料不外传）。
   每个特效有锚点，链接写成 `https://dongxiao.zygskins.cn/#<id>` 可以直接发给别人看。
2. **让 AI 按场景挑**：`npx dongxiao-find <场景> [气质] [--mobile]`，例如 `npx dongxiao-find hero game --mobile`；
   代码里 `findEffects({ scene: "hero", mobile: true })`（`import { findEffects } from "dongxiao/catalog"`）。
3. **按场景推荐表**：`./node_modules/dongxiao/EFFECTS.md`（Hero / 背景 / 卡片 / 列表 / 按钮 / 加载 / 揭晓…，带层级、开销、手机可用）；
   每个组件的 props 与写法在 `./node_modules/dongxiao/INTEGRATION.md`。
4. 只用**子路径导入**：`import { DotField } from "dongxiao/backgrounds/dot-field"`，带样式的再 import 一次 `.../styles.css`；
   不要从包根 `"dongxiao"` 一把导入。用到要 `ogl` / `three` / `gsap` 的组件，按清单 `deps` 另装（都是 optional peer）。

## 必守的规矩

- **一页只有一个 A 层主角**（开奖、揭晓、首屏大标题演出）；它演出时 `setPaused(true)` 把其余装饰全部按停。
- **一屏最多一块 WebGL 背景**；列表卡片用纯 CSS / 2D 的 `SpotlightCard`、`GlareHover`，不要逐卡挂 WebGL（浏览器只有 8–16 个上下文名额）。
- **首屏只放轻特效**（CSS / Canvas 2D）。`three`、`@react-three/*`、`ogl`、`gsap`、`matter-js`、`postprocessing`、`maath`、`troika`
  只许在首屏以下用 `React.lazy` + `LazyEffect` 加载，写法照 `aurora-section.tsx`；`*-scene.tsx` 只许被动态 import。
  `pnpm check:bundle` 卡首屏 ≤ 300 KB JS / ≤ 40 KB CSS（gzip），重依赖进首屏直接红 —— 超了挪进懒加载块，**别调高预算**。
- **paused / autoPause**：离屏、切后台、减少动态效果由组件内建处理（`autoPause` 缺省开，别随手关）；`paused` 一律从 `useMotion()` 传。
  背景类组件都给 `fallback`（纯 CSS 渐变），减少动态效果 / WebGL 丢失时不留空白。
- **颜色只从令牌来**：CSS 写 `var(--brand)`；dongxiao 组件用 `useTokens()` 拿具体色值当 props（WebGL / Canvas 解析不了 `var(--x)`）；
  admin-ui 的色卡已接 `--brand`。调用处不写死色值。换肤 / 赛季换皮只改 `tokens.css`。
- 文字特效多数渲染 `<p>` / `<div>`，不能塞进 `<h1>`：标题写一份隐藏的 `<h1>` 给读屏，特效层 `aria-hidden`。
- 不给组件传第三方 CDN 的图片 / 字体 / 模型（境外 CDN 慢或被墙就整块空白）；dongxiao 内置素材已随包打进产物，零外链。

## 版权红线

dongxiao 的组件源自 React Bits（**MIT + Commons Clause**）：**只能作为公司自己产品的一部分使用**。
本站点可以照常上线（组件作为站点的一部分随产物发出去没问题）；但**永远不要**把 dongxiao 本身发到公共 npm、
单独再分发，或把它的组件源码拷进任何公开仓库（包括开源版的 admin-ui）。

## 升级

1. 查最新 tag：`git ls-remote --tags --refs http://s3.alonelife.top:32109/admin/yanzheng.git "dongxiao-v*" "adminUI-v*"`；
   或重跑配方（只会提示，不改已有文件）。
2. 在 `./package.json` 里**同时**改 `dongxiao` 和 `@ankotti/admin-ui` 两行的 `#<tag>`；monorepo 里每个用到 admin-ui 的包必须钉同一个 tag
   （`admin-ui-audit` 的 `split-version` 规则会报出不一致的行，只升一半会装出两份 SDK、两份都进首屏）。
3. `pnpm install` → `pnpm check:bundle` → `pnpm --filter <web 包> typecheck` → 打开页面看一遍；版本变更（package.json + lockfile）单独提交，方便回退。
