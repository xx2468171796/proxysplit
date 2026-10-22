// 配方门禁：用 qiantai 的 parseRecipe 校验 src/recipe.ts（浅色 / 深色、有无版本号四种），格式错或引用不存在就失败；
// 预算提醒（budgetWarnings）也当失败处理 —— 本站是工具类产品，不该触发。经 Vite 的 SSR 加载器跑，CSS / tsx 照常处理。
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  ssr: { noExternal: ["qiantai", "dongxiao", "@ankotti/admin-ui"] },
});
let failed = false;
try {
  const { parseRecipe } = await server.ssrLoadModule("qiantai");
  const { siteRecipe } = await server.ssrLoadModule("/src/recipe.ts");
  for (const [version, dark] of [
    [null, false],
    ["1.9.80", false],
    [null, true],
    ["1.9.80", true],
  ]) {
    const r = parseRecipe(siteRecipe(version, dark));
    const tag = `配方（${dark ? "深色" : "浅色"}，版本 ${version ?? "无"}）`;
    if (!r.ok) {
      failed = true;
      console.error(`${tag}：${r.message}\n  ${r.issues.join("\n  ")}`);
    } else if (r.warnings.length) {
      failed = true;
      console.error(`${tag} 有预算提醒：\n  ${r.warnings.join("\n  ")}`);
    }
  }
} finally {
  await server.close();
}
if (failed) process.exitCode = 1;
else console.log("Recipe check passed");
