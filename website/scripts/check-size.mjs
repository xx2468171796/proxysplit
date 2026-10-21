// 体量上限检查（rules/coding-standards.md「体量上限」）：文件行数超过硬上限就失败，超过提示线只提醒。
// 与语言无关：TS / JS / Go / Rust 都按同一套上限；生成物、迁移、词条目录不检查。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".vue", ".svelte"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  ".git",
  "coverage",
  "generated",
  "migrations",
  "i18n",
  "locales",
  "vendor",
]);
const LIMITS = {
  component: { warn: 150, max: 300 },
  test: { warn: 500, max: 800 },
  source: { warn: 300, max: 500 },
};

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function limitFor(path) {
  if (/\.(test|spec)\.[^.]+$/.test(path) || /_test\.go$/.test(path)) return LIMITS.test;
  if (/\.(tsx|jsx|vue|svelte)$/.test(path)) return LIMITS.component;
  return LIMITS.source;
}

function hasException(source) {
  return /例外：体量上限/.test(source.slice(0, 400));
}

const failures = [];
const warnings = [];
for (const file of walk(root)) {
  if (!SOURCE_EXTENSIONS.has(extname(file)) || file.endsWith(".d.ts")) continue;
  const path = relative(root, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n").length;
  const limit = limitFor(path);
  if (lines > limit.max && !hasException(source)) failures.push(`${path}: ${lines} 行，超过硬上限 ${limit.max}`);
  else if (lines > limit.warn) warnings.push(`${path}: ${lines} 行，超过提示线 ${limit.warn}，考虑按职责拆分`);
}

for (const warning of warnings) console.warn(`提示 ${warning}`);
if (failures.length) {
  console.error(failures.join("\n"));
  console.error("按职责拆分；确属例外时在文件开头写「// 例外：体量上限 —— <原因>」。");
  process.exitCode = 1;
} else {
  console.log(`Size limits passed (${warnings.length} warning(s))`);
}
