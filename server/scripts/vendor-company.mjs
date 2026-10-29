// 把公司包（yanzheng 仓 packages/<包>，编译产物 JS + .d.ts）按固定 tag 拷进 packages/core/src/vendor/<包>/。
// 生产镜像构建走 npmmirror、拉不到内网 Gitea，所以服务端用到的公司包都 vendor 进仓。
// 用法：node scripts/vendor-company.mjs <yanzheng 仓本地检出路径> [包名…]   不给包名 = 全部。
// 升级：改下面 PACKAGES 里的 tag 后重跑并提交（先在 yanzheng 仓 git fetch --tags）。
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** tag 固定；skip = 服务端用不到的子目录（React 组件、命令行） */
const PACKAGES = {
  fenxiao: { tag: 'fenxiao-v0.1.0', skip: [] },
  tongzhi: { tag: 'tongzhi-v1.7.0', skip: ['react/', 'cli/'] },
  zhanghao: { tag: 'zhanghao-v1.19.1', skip: ['react/', 'store/drizzle-pg', 'zhctl'] },
}

const repo = process.argv[2]
if (!repo) {
  console.error('用法: node scripts/vendor-company.mjs <yanzheng 仓路径> [包名…]')
  process.exit(1)
}
const names = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(PACKAGES)
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 16 << 20, timeout: 60_000 })
const vendorRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core', 'src', 'vendor')

for (const name of names) {
  const spec = PACKAGES[name]
  if (!spec) {
    console.error(`未知包 ${name}（在 PACKAGES 里登记）`)
    process.exit(1)
  }
  const srcDir = `packages/${name}/dist/src`
  const files = git('ls-tree', '-r', '--name-only', `${spec.tag}:${srcDir}`)
    .split('\n')
    .filter((f) => (f.endsWith('.js') || f.endsWith('.d.ts')) && !spec.skip.some((s) => f.startsWith(s)))
  if (files.length === 0) {
    console.error(`${spec.tag} 里没有 ${srcDir}`)
    process.exit(1)
  }
  const out = join(vendorRoot, name)
  rmSync(out, { recursive: true, force: true })
  for (const f of files) {
    // 去掉 sourceMappingURL：map 文件不 vendor
    const body = git('show', `${spec.tag}:${srcDir}/${f}`).replace(/\n\/\/# sourceMappingURL=.*$/m, '')
    mkdirSync(dirname(join(out, f)), { recursive: true })
    writeFileSync(join(out, f), body)
  }
  writeFileSync(join(out, 'VERSION'), `${spec.tag}\n`)
  console.log(`vendored ${files.length} files from ${spec.tag} → ${out}`)
}
