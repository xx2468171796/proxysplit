// 把公司包（yanzheng 仓 packages/<包>，编译产物 JS + .d.ts）按固定 tag 拷进 packages/core/src/vendor/<包>/。
// 生产镜像构建走 npmmirror、拉不到内网 Gitea，所以服务端用到的公司包都 vendor 进仓。
// 用法：node scripts/vendor-company.mjs <yanzheng 仓本地检出路径> [包名…]   不给包名 = 全部。
// 升级：改下面 PACKAGES 里的 tag 后重跑并提交（先在 yanzheng 仓 git fetch --tags）。
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

/** tag 固定；skip = 服务端用不到的子目录（React 组件、命令行）；
 *  entries = 只拷这些入口（相对 dist/src 的 .js）沿 import 递归用到的文件（包大、服务端只用一小部分时用） */
const PACKAGES = {
  fenxiao: { tag: 'fenxiao-v0.1.0', skip: [] },
  tongzhi: { tag: 'tongzhi-v1.7.0', skip: ['react/', 'cli/'] },
  zhanghao: { tag: 'zhanghao-v1.19.1', skip: ['react/', 'store/drizzle-pg', 'zhctl'] },
  // 统一支付中心（PAY_MODE=center）：只用 zhifu/site + zhifu/center；运行时依赖 zod（core package.json 已加）
  zhifu: { tag: 'zhifu-v6.17.1', skip: [], entries: ['site/index.js', 'center/index.js'] },
  // 雷池验证中心客户端（短信验证码走中心，sms-center.ts）：只用 verify-client + 纯函数 sms/phone；只依赖 node:http / https / crypto / net
  yanzheng: { tag: 'yanzheng-v2.43.0', skip: [], entries: ['verify-client/index.js', 'sms/phone.js'] },
}

const repo = process.argv[2]
if (!repo) {
  console.error('用法: node scripts/vendor-company.mjs <yanzheng 仓路径> [包名…]')
  process.exit(1)
}
const names = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(PACKAGES)
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 16 << 20, timeout: 60_000 })
const vendorRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core', 'src', 'vendor')

/** entries 沿相对 import（.js 与 .d.ts 都走）递归，返回要拷的文件集合 */
function closure(tag, srcDir, entries, exists) {
  const seen = new Set()
  const queue = entries.flatMap((e) => [e, e.replace(/\.js$/, '.d.ts')])
  while (queue.length) {
    const f = queue.pop()
    if (seen.has(f) || !exists.has(f)) continue
    seen.add(f)
    const body = git('show', `${tag}:${srcDir}/${f}`)
    for (const m of body.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const target = posix.normalize(posix.join(posix.dirname(f), m[1]))
      const stem = target.replace(/\.(d\.ts|js|ts)$/, '')
      queue.push(`${stem}.js`, `${stem}.d.ts`)
    }
  }
  return seen
}

for (const name of names) {
  const spec = PACKAGES[name]
  if (!spec) {
    console.error(`未知包 ${name}（在 PACKAGES 里登记）`)
    process.exit(1)
  }
  const srcDir = `packages/${name}/dist/src`
  const all = git('ls-tree', '-r', '--name-only', `${spec.tag}:${srcDir}`).split('\n')
  const wanted = spec.entries ? closure(spec.tag, srcDir, spec.entries, new Set(all)) : null
  const files = all.filter(
    (f) => (f.endsWith('.js') || f.endsWith('.d.ts')) && !spec.skip.some((s) => f.startsWith(s)) && (!wanted || wanted.has(f)),
  )
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
