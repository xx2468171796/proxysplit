// 把公司 SDK tuiguang 的多级分销子路径（tuiguang/fenxiao，编译产物 JS + .d.ts）按固定 tag 拷进
// packages/core/src/vendor/fenxiao/。生产镜像构建走 npmmirror、拉不到内网 Gitea，所以 vendor 进仓。
// 用法：node scripts/vendor-fenxiao.mjs <yanzheng 仓本地检出路径>   升级：改 UPSTREAM_TAG 后重跑并提交。
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM_TAG = 'tuiguang-v1.8.2'
const SRC_DIR = 'packages/tuiguang/dist/src/fenxiao'
const repo = process.argv[2]
if (!repo) { console.error('用法: node scripts/vendor-fenxiao.mjs <yanzheng 仓路径>'); process.exit(1) }

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core', 'src', 'vendor', 'fenxiao')
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 16 << 20, timeout: 60_000 })

const files = git('ls-tree', '--name-only', `${UPSTREAM_TAG}:${SRC_DIR}`).split('\n').filter(f => f.endsWith('.js') || f.endsWith('.d.ts'))
if (files.length === 0) { console.error(`${UPSTREAM_TAG} 里没有 ${SRC_DIR}`); process.exit(1) }
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const f of files) {
  // 去掉 sourceMappingURL：map 文件不 vendor
  const body = git('show', `${UPSTREAM_TAG}:${SRC_DIR}/${f}`).replace(/\n\/\/# sourceMappingURL=.*$/m, '')
  writeFileSync(join(out, f), body)
}
writeFileSync(join(out, 'VERSION'), `${UPSTREAM_TAG}\n`)
console.log(`vendored ${files.length} files from ${UPSTREAM_TAG} → ${out}`)
