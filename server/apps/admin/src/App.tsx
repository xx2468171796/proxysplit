import * as React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { hasToken } from '@/lib/api'
import { AppShell } from '@/components/app-shell'
import { Login } from '@/pages/login'
import DashboardPage from '@/pages/dashboard'
import UsersPage from '@/pages/users'
import DevicesPage from '@/pages/devices'
import PlansPage from '@/pages/plans'
import OrdersPage from '@/pages/orders'
import RedeemPage from '@/pages/redeem'
import PaymentsPage from '@/pages/payments'
import AnnouncementsPage from '@/pages/announcements'
import ReleasesPage from '@/pages/releases'
import DownloadsPage from '@/pages/downloads'
import AuditPage from '@/pages/audit'
import SettingsPage from '@/pages/settings'
import FenxiaoPage from '@/pages/fenxiao'
import ClientLogsPage from '@/pages/client-logs'

export function App() {
  const [signed, setSigned] = React.useState(hasToken())

  if (!signed) return <Login onDone={() => setSigned(true)} />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="redeem" element={<RedeemPage />} />
        <Route path="fenxiao" element={<FenxiaoPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="releases" element={<ReleasesPage />} />
        <Route path="downloads" element={<DownloadsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="client-logs" element={<ClientLogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
