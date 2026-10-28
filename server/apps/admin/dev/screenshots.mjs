// 运营后台截图（1440 / 390 / 360 浅色 + 1440 深色），交付前逐张看。
// 先起假 API 和 dev 服务（server/apps/admin 下）：
//   node dev/mock-api.mjs 18799
//   VITE_API_URL=http://127.0.0.1:18799 pnpm dev
// 再截图：node dev/screenshots.mjs [输出目录] [额外路径...]
//   环境变量 BASE（默认 http://127.0.0.1:18781）、CHROME（默认用本机 ms-playwright 里装好的 chromium）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const [outArg, ...extra] = process.argv.slice(2)
const out = outArg || path.join(os.tmpdir(), 'psx', 'shots')
const base = process.env.BASE || 'http://127.0.0.1:18781'
const FIRST_USER = 'aaaaaaaa-0000-4000-8000-000000000001'
// 额外路径写 admin/devices 或 /admin/devices 都行（Git Bash 会把 /admin/... 改写成 C:/Program Files/Git/admin/...，这里截掉）。
const norm = (p) => { const i = p.indexOf('admin/'); return i >= 0 ? '/' + p.slice(i) : '/admin/' + p.replace(/^\//, '') }
const pages = ['/admin/', '/admin/users', `/admin/users/${FIRST_USER}`, '/admin/orders', '/admin/settings', ...extra.map(norm)]
const shots = [
  { tag: '1440', width: 1440, height: 900, dark: false },
  { tag: '390', width: 390, height: 844, dark: false },
  { tag: '360', width: 360, height: 780, dark: false },
  { tag: '1440-dark', width: 1440, height: 900, dark: true },
]

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const root = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : []
  for (const d of dirs) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe')
    if (fs.existsSync(exe)) return exe
  }
  return undefined
}

const name = (p) => p.replace(/^\/admin\/?/, '').replace(/[^a-z0-9-]+/gi, '_').slice(0, 40) || 'overview'

fs.mkdirSync(out, { recursive: true })
const executablePath = findChrome()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
try {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, colorScheme: s.dark ? 'dark' : 'light', deviceScaleFactor: 1, isMobile: s.width < 760, hasTouch: s.width < 760 })
    await ctx.addInitScript((dark) => {
      sessionStorage.setItem('ps-admin-token', 'mock')
      sessionStorage.setItem('ps-admin-user', 'admin')
      localStorage.setItem('proxysplit:admin:mode', dark ? 'dark' : 'light')
    }, s.dark)
    const page = await ctx.newPage()
    for (const p of pages) {
      await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => undefined)
      await page.waitForTimeout(800)
      const file = path.join(out, `${name(p)}-${s.tag}.png`)
      await page.screenshot({ path: file, fullPage: true })
      console.log(file)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
