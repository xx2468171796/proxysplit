import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  Boxes,
  CreditCard,
  Download,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Network,
  Monitor,
  Moon,
  PackageOpen,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Ticket,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { logout } from '@/lib/api'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  title: string
  subtitle: string
}

/** 导航 + 页面标题元信息（路由与标题的单一数据源）。 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '概览', icon: LayoutDashboard, title: '运营概览', subtitle: '会员、订单、收入、授权与设备运行状态' },
  { to: '/users', label: '用户与会员', icon: Users, title: '用户与会员', subtitle: '创建账号、调整授权、暂停与封禁' },
  { to: '/devices', label: '设备', icon: Monitor, title: '设备管理', subtitle: '查看硬件绑定、解绑设备并强制下线' },
  { to: '/plans', label: '套餐', icon: Layers3, title: '套餐配置', subtitle: '普通会员、超级会员、月卡、季卡、年卡和永久套餐' },
  { to: '/orders', label: '订单', icon: ShoppingCart, title: '充值订单', subtitle: '支付状态、到账金额，支持手动确认发货' },
  { to: '/redeem', label: '兑换码', icon: Ticket, title: '兑换码', subtitle: '批量生成授权码，自定义会员等级与时长' },
  { to: '/fenxiao', label: '分销', icon: Network, title: '多级分销', subtitle: '分销商 / 经销商、推荐关系、佣金流水、提现审核与分佣规则' },
  { to: '/payments', label: '支付通道', icon: CreditCard, title: '支付通道', subtitle: '配置并切换收款 Provider，密钥只引用服务器环境变量' },
  { to: '/announcements', label: '公告', icon: Megaphone, title: '公告管理', subtitle: '活动公告、维护通知和客户端更新说明' },
  { to: '/releases', label: '版本', icon: PackageOpen, title: '版本发布', subtitle: '升级清单、强制升级和版本日志' },
  { to: '/downloads', label: '下载统计', icon: Download, title: '下载与浏览统计', subtitle: '按 IP / 访客去重的下载量、浏览量、版本与来源分布' },
  { to: '/audit', label: '审计', icon: Activity, title: '审计日志', subtitle: '管理员关键操作与结果追踪' },
  { to: '/settings', label: '商业设置', icon: Settings2, title: '商业设置', subtitle: '注册、免费试用、设备默认值和离线授权策略' },
]

function currentMeta(pathname: string): NavItem {
  // 最长前缀匹配（根路由单独处理）。
  if (pathname === '/' || pathname === '') return NAV_ITEMS[0]!
  const hit = NAV_ITEMS.slice(1).find((n) => pathname === n.to || pathname.startsWith(n.to + '/'))
  return hit ?? NAV_ITEMS[0]!
}

function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} title="切换主题">
      {resolvedTheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      <span className="sr-only">切换主题</span>
    </Button>
  )
}

export function AppShell() {
  const location = useLocation()
  const meta = currentMeta(location.pathname)

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* 侧边栏 */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold">ProxySplit</div>
            <div className="text-xs text-muted-foreground">COMMERCIAL CONSOLE</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            安全运营模式
          </div>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{meta.title}</h1>
            <p className="truncate text-xs text-muted-foreground">{meta.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="管理员">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    AD
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>管理员</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <User className="h-4 w-4" />
                  运营后台
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* 移动端顶部导航 */}
        <div className="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
                  isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
