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

document.querySelectorAll('[data-download]').forEach((link) => {
  link.addEventListener('click', () => {
    try { localStorage.setItem('proxysplit:last-download', new Date().toISOString()) } catch {}
  })
})
