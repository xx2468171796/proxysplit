# 前端（@ankotti/admin-ui 重写）

> 结构见 docs/architecture.md。分支 feat/admin-ui-frontend，尚未发版；发版前先确认门禁全绿。

## 现状（2026-10-22）
前端已用 @ankotti/admin-ui 重写，技术栈 React 19 + Vite 8 + TS 7 + pnpm 12.9.1，替换旧的单文件 Svelte（旧 `npm run check/build` 不再适用）。
- 主色近黑墨色：浅色 #1c1f24 / 深色 #6b7584。组件库深色会把主色压暗，近黑会看不见，所以深色单独用 #6b7584。
- 无背景光晕，motionStyle calm。
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

## 绑定与构建
Wails 构建会重新生成 frontend/wailsjs 绑定，需随提交带上；正式构建流程见 release-process.md。

## 旧界面遗留约定（迁移时保持行为）
- 应用分流页按 整机全局 / 代理策略 / 分流模式 显示说明条，「未列出的应用」替代「默认出口」。
- 概览延迟按好坏着色；深色需要 --surface-3 / --bad-bg 等价色。
- 顶部常驻提示：安全软件拦截（net-blocked）、自动更新失败等；AI 环境检测与一键修复在概览页。
- 自定义线路下拉可选；改别的应用不应把它冲成「规则」。
