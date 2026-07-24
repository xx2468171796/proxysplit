const header = document.querySelector('[data-header]')
const menuButton = document.querySelector('[data-menu-button]')
const mobileNav = document.querySelector('[data-mobile-nav]')

const setHeader = () => header?.classList.toggle('scrolled', window.scrollY > 18)
setHeader()
window.addEventListener('scroll', setHeader, { passive: true })

menuButton?.addEventListener('click', () => {
  const open = mobileNav?.classList.toggle('open') ?? false
  menuButton.setAttribute('aria-expanded', String(open))
})
mobileNav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  mobileNav.classList.remove('open')
  menuButton?.setAttribute('aria-expanded', 'false')
}))

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible')
      observer.unobserve(entry.target)
    }
  })
}, { threshold: 0.12 })
document.querySelectorAll('.reveal').forEach((node) => observer.observe(node))

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-download]')) {
    try { localStorage.setItem('proxysplit:last-download', new Date().toISOString()) } catch {}
  }
})

const latestRelease = fetch('/v1/releases/latest', { headers: { accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error('release unavailable')))
  .then(({ release }) => {
    if (!release || !/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error('invalid release')
    return { version: release.version, url: `/download/proxysplit-v${release.version}.exe` }
  })
  .catch(() => null)

function applyLatestDownload(release, root = document) {
  if (!release) return
  root.querySelectorAll('[data-download]').forEach((link) => { link.href = release.url })
  root.querySelectorAll('[data-download-version]').forEach((node) => {
    node.textContent = `下载 v${release.version}`
  })
  root.querySelectorAll('[data-latest-version]').forEach((node) => {
    node.innerHTML = `<i class="check">✓</i> 当前版本 v${release.version}`
  })
}
latestRelease.then((release) => applyLatestDownload(release))

const planGrid = document.querySelector('[data-plan-grid]')
if (planGrid) {
  fetch('/v1/catalog/plans', { headers: { accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('catalog unavailable')))
    .then(({ items = [] }) => {
      if (!items.length) {
        planGrid.innerHTML = '<article class="pricing-placeholder"><span>套餐准备中</span><p>套餐启用后会自动展示；当前可下载客户端领取免费试用。</p></article>'
        return
      }
      planGrid.innerHTML = items.map((plan) => {
        const period = plan.lifetime ? '永久有效' : `${plan.durationDays || 0} 天`
        const tier = plan.tier === 'premium' ? '超级会员' : '普通会员'
        return `<article class="pricing-card ${plan.tier === 'premium' ? 'premium' : ''}">
          <div><span>${escapeHTML(plan.badge || tier)}</span><em>${plan.maxDevices} 台设备</em></div>
          <h3>${escapeHTML(plan.name)}</h3>
          <strong><small>¥</small>${(Number(plan.priceCents) / 100).toFixed(2)}${Number(plan.originalPriceCents) > Number(plan.priceCents) ? `<del>¥${(Number(plan.originalPriceCents) / 100).toFixed(2)}</del>` : ''}</strong>
          <p>${escapeHTML(plan.description || '')}</p>
          <ul><li>${period}</li><li>${tier}</li><li>服务端签名授权</li></ul>
          <a href="/download/proxysplit-v1.9.24.exe" data-download>支付宝开通</a>
        </article>`
      }).join('')
      latestRelease.then((release) => applyLatestDownload(release, planGrid))
    })
    .catch(() => {
      planGrid.innerHTML = '<article class="pricing-placeholder"><span>套餐暂不可用</span><p>请稍后重试，或在客户端会员中心查看。</p></article>'
    })
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}
