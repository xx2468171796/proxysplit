import * as React from 'react'

type Theme = 'dark' | 'light' | 'system'

interface ThemeProviderState {
  theme: Theme
  resolvedTheme: 'dark' | 'light'
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'ps-admin-theme'

const ThemeProviderContext = React.createContext<ThemeProviderState | null>(null)

function systemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) || 'system',
  )
  const [resolved, setResolved] = React.useState<'dark' | 'light'>(() =>
    theme === 'system' ? systemTheme() : theme,
  )

  React.useEffect(() => {
    const next = theme === 'system' ? systemTheme() : theme
    setResolved(next)
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(next)
  }, [theme])

  React.useEffect(() => {
    if (theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const next = systemTheme()
      setResolved(next)
      const root = window.document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(next)
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  const setTheme = React.useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t)
    setThemeState(t)
  }, [])

  const value = React.useMemo<ThemeProviderState>(
    () => ({
      theme,
      resolvedTheme: resolved,
      setTheme,
      toggleTheme: () => setTheme(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [theme, resolved, setTheme],
  )

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeProviderContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
