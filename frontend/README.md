# ProxySplit 界面

React 19 + Vite 8 + TypeScript 7 + 公司组件库 `@ankotti/admin-ui`（钉 tag，见 `package.json`），由 Wails 内嵌进 exe。结构和规则见 `../docs/architecture.md`。

## 常用命令

```bash
pnpm install          # 依赖（admin-ui 从公司 Gitea 按 tag 拉取）
pnpm dev              # 浏览器预览：没有 Wails 时自动换成假后端（src/dev/mock-backend.ts）
pnpm check            # 类型检查 + Biome + 单测 + admin-ui-audit + 文件体量
pnpm build            # 生成 dist/，wails build 会自动调用
```

浏览器预览参数：`?gate=login` 未登录页，`?gate=member` 无权益会员页，`?update=1` 有新版本，`?update=force` 强制升级。

## 约定

- 只有 `src/api/backend.ts` 调 Go；数据和动作在 `src/state/`；页面在 `src/features/<页面>/`，只读 store、调动作。
- 控件、颜色、间距只用 admin-ui 的组件和 `var(--aui-…)` 变量；自己的少量样式类名以 `ps-` 开头。
- 升级组件库：`node ~/.ankotti/ai-kit/admin-ui.mjs upgrade`，读包里 CHANGELOG，再跑 `pnpm audit:ui` 改到 0 错误。
