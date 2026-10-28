import '@ankotti/admin-ui/styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminProvider, NotificationProvider } from '@ankotti/admin-ui'
import { App } from './App'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AdminProvider storageKey="proxysplit:admin" mode="system" defaults={{ timeZone: 'Asia/Shanghai', currency: '¥', phoneCountry: '+86' }}>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </AdminProvider>
    </StrictMode>,
  )
}
