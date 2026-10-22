# 前端（@ankotti/admin-ui 重写）

> 结构见 docs/architecture.md。分支 feat/admin-ui-frontend，尚未发版；发版前先确认门禁全绿。

## 现状（2026-10-22）
前端已用 @ankotti/admin-ui 重写，技术栈 React 19 + Vite 8 + TS 7 + pnpm 12.9.1，替换旧的单文件 Svelte（旧 `npm run check/build` 不再适用）。
- 主色近黑墨色：浅色 #1c1f24 / 深色 #6b7584。组件库深色会把主色压暗，近黑会看不见，所以深色单独用 #6b7584。
- admin-ui 不开背景光晕（ambient none），motionStyle calm；背景特效由桌面外壳的「外观」负责（默认很淡的柔光）。
- 新图标：墨色圆角方块 + 白色分叉箭头。

## 门禁
`pnpm --dir frontend check` = typecheck / biome / vitest / admin-ui-audit / check-size，提交前必须全绿。
- 改后台 / 面板类界面按 `ankotti-admin-backend` 技能，只用 @ankotti/admin-ui 的组件、主题与颜色。
- 文件 ≤ 500 行（组件 ≤ 300），不用 any / 非空断言 / default export（rules/coding-standards.md）。

## 开发预览
`pnpm --dir frontend dev`：没有 Wails 运行时会自动装 mock，用 URL 参数切状态。
- `?theme=dark` 深色。
- `?gate=login|member` 登录门 / 会员门。
- `?split=1` 应用分流页。
- `?update=1|force` 更新提示 / 强制更新。
- `?page=apps` 指定页、`?look=1` 外观面板、`?donate=0` 自动关赞赏码。

## 绑定与构建
Wails 构建会重新生成 frontend/wailsjs 绑定，需随提交带上；正式构建流程见 release-process.md。

## 旧界面遗留约定（迁移时保持行为）
- 应用分流页按 整机全局 / 代理策略 / 分流模式 显示说明条，「未列出的应用」替代「默认出口」。
- 概览延迟按好坏着色；深色需要 --surface-3 / --bad-bg 等价色。
- 顶部常驻提示：安全软件拦截（net-blocked）、自动更新失败等；AI 环境检测与一键修复在概览页。
- 自定义线路下拉可选；改别的应用不应把它冲成「规则」。

## 桌面外壳（2026-10-22，分支 redesign-desktop）
- 外壳换成 qiantai 的 `DesktopShell`（`qiantai#qiantai-v0.5.0`，**只从 `qiantai/desktop` import**，根入口会带进约 550 KB 示例图）：自绘标题栏（节点 / 代理策略 / 速率 / 外观 / 启停）+ 左侧导航 + 账号菜单（admin-ui `AccountMenu`）。Wails 保留系统边框，`windowControls={false}`。
- 设计语言 clean-modern，qiantai 与 AdminProvider 用同一主色、同一明暗（`app/theme.ts`）。毛玻璃时只改变量 `--aui-surface` 为半透明（不写 `.aui-*` 选择器，audit 禁止）；业务 Panel 加 `className="qd-pane"` 得到模糊。
- 默认外观：柔光背景浓淡 35、毛玻璃、均衡画质、智能暂停（`seedDefaultAppearance`：本机没存过 `proxysplit:backdrop` 才写入）。
- 首屏 JS gzip：225.2 → 237.6 KB（+12.4），CSS 64.3 → 67.9 KB；WebGL 背景是懒加载分块。
- 预览参数（dev/preview-params.ts）：`?page=<页面 id>`、`?look=1` 打开外观面板、`?donate=0` 赞赏码倒计时结束自动关。评审包：`VITE_MOCK=1 vite build -c vite.review.config.ts --outDir <构建目录>` 再 `node scripts/review-pages.mjs <构建目录> <输出目录>`，每个画面一个单文件页（页面审阅台用无 allow-same-origin 的沙箱 iframe，分开的 JS 模块会跨域失败、整页空白；地址参数改由页面写进 `__PS_QUERY`，见 dev/search.ts）。正式构建不设 VITE_MOCK。
- 假后端没有「停止」：概览的停止态在预览里看不到。
